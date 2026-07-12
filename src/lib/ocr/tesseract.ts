import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const OCR_PROCESS_TIMEOUT_MS = 45_000;
/** Higher concurrency for multi-page scanned handbooks (big speed win). */
const OCR_CONCURRENCY = 6;

async function recognize(path: string, signal?: AbortSignal): Promise<string> {
  const { stdout } = await run("tesseract", [path, "stdout", "-l", "tha+eng", "--psm", "3"], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: OCR_PROCESS_TIMEOUT_MS,
    signal,
  });
  return stdout;
}

export async function ocrImage(
  buffer: Buffer,
  extension: "png" | "jpg",
  signal?: AbortSignal,
  onProgress?: (percent: number, message: string) => void
) {
  const dir = await mkdtemp(join(tmpdir(), "thai-ocr-"));
  try {
    const input = join(dir, `input.${extension}`);
    await writeFile(input, buffer);
    onProgress?.(40, "Running OCR on the image…");
    const text = await recognize(input, signal);
    onProgress?.(90, "OCR complete. Cleaning extracted text…");
    return text;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function ocrPdf(
  buffer: Buffer,
  signal?: AbortSignal,
  onProgress?: (percent: number, message: string) => void
) {
  const dir = await mkdtemp(join(tmpdir(), "thai-ocr-"));
  try {
    const input = join(dir, "input.pdf");
    const prefix = join(dir, "page");
    await writeFile(input, buffer);
    onProgress?.(28, "Rendering scanned PDF pages for OCR…");
    // 200 DPI is enough for clean print scans and is much faster than 250.
    await run("pdftoppm", ["-f", "1", "-l", "40", "-jpeg", "-r", "200", input, prefix], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
      signal,
    });
    const pages = (await readdir(dir)).filter((name) => /^page-.*\.jpg$/.test(name)).sort();
    onProgress?.(40, `Starting OCR on ${pages.length} page${pages.length === 1 ? "" : "s"}…`);
    const output = new Array<string>(pages.length);
    let nextPage = 0;
    let completedPages = 0;
    const worker = async () => {
      while (nextPage < pages.length) {
        const index = nextPage++;
        output[index] = await recognize(join(dir, pages[index]), signal);
        completedPages += 1;
        const percent = 40 + Math.round((completedPages / pages.length) * 50);
        onProgress?.(
          percent,
          `OCR page ${completedPages} of ${pages.length}…`
        );
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(OCR_CONCURRENCY, pages.length) }, worker)
    );
    const note = pages.length === 40 ? "[Note: OCR processed the first 40 pages only.]\n\n" : "";
    return note + output.join("\n\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
}
