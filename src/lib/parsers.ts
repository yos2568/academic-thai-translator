import "server-only";
import mammoth from "mammoth";
import { ValidationError, type SupportedType } from "./validation";
import { ocrImage, ocrPdf } from "./ocr/tesseract";

export interface ExtractionMetadata {
  pageCount?: number;
  pageParagraphCounts?: number[];
}

/** Collapse odd whitespace but preserve paragraph structure. */
function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // strip control characters except newline/tab
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function paragraphCount(text: string): number {
  return normalizeText(text).split(/\n{2,}/).filter(Boolean).length;
}

async function extractPdf(buffer: Buffer): Promise<{ text: string; metadata: ExtractionMetadata }> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      parser.getText(),
      new Promise<never>((_, reject) =>
        (timer = setTimeout(
          () => reject(new Error("PDF text extraction timed out.")),
          30_000
        ))
      ),
    ]);
    // Keep page breaks as paragraph boundaries.
    return {
      text: result.pages.map((p) => p.text).join("\n\n"),
      metadata: {
        pageCount: result.pages.length,
        pageParagraphCounts: result.pages.map((page) => paragraphCount(page.text)),
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
    await Promise.race([
      parser.destroy(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}

function extractTxt(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

export async function extractText(
  type: SupportedType,
  buffer: Buffer,
  signal?: AbortSignal,
  onProgress?: (percent: number, message: string) => void
): Promise<{ text: string; ocr: boolean } & ExtractionMetadata> {
  let raw: string;
  let ocr = false;
  let metadata: ExtractionMetadata = {};
  try {
    if (type === "docx") {
      onProgress?.(25, "Reading Word document text…");
      raw = await extractDocx(buffer);
      onProgress?.(90, "Document text extracted. Cleaning text…");
    }
    else if (type === "pdf") {
      onProgress?.(22, "Checking the PDF text layer…");
      const pdf = await extractPdf(buffer);
      raw = pdf.text;
      metadata = pdf.metadata;
      if (!normalizeText(raw)) {
        onProgress?.(26, "No text layer found. Switching to OCR…");
        raw = await ocrPdf(buffer, signal, onProgress);
        ocr = true;
        metadata = {};
      } else {
        onProgress?.(90, "PDF text extracted. Cleaning text…");
      }
    } else if (type === "png" || type === "jpg") {
      raw = await ocrImage(buffer, type, signal, onProgress); ocr = true;
    } else {
      onProgress?.(50, "Reading text file…");
      raw = extractTxt(buffer);
      onProgress?.(90, "Text loaded. Cleaning text…");
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    const detail = err instanceof Error ? err.message : "";
    const processError = err as {
      code?: string;
      killed?: boolean;
      signal?: string;
    };
    if (
      /aborted|timed out|timeout/i.test(detail) ||
      processError.code === "ABORT_ERR" ||
      processError.killed === true ||
      processError.signal === "SIGTERM"
    ) {
      throw new ValidationError(
        "Document reading took too long and was stopped. For scanned PDFs, split the file into smaller sections and try again."
      );
    }
    if (/tesseract|pdftoppm|ENOENT/i.test(detail)) {
      throw new ValidationError(
        "OCR is not available on this server. Install Tesseract (tha+eng) and Poppler, then try the scan again."
      );
    }
    if (/password|encrypt/i.test(detail)) {
      throw new ValidationError(
        "This PDF is password-protected. Please remove the password and try again."
      );
    }
    throw new ValidationError(
      `Could not read the ${type.toUpperCase()} file. It may be corrupted.`
    );
  }

  const text = normalizeText(raw);
  if (!text) {
    throw new ValidationError(
      "No readable text was found. If this is a scan, make sure Tesseract with Thai and English language data is installed."
    );
  }
  return { text, ocr, ...metadata };
}
