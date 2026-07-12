import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, posix } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import type { SupportedType } from "./validation";
import { clamp, hasMagicBytes } from "./util";
import type { CapturedDocumentImage, CapturedImageType } from "./document-image-types";

export type { CapturedDocumentImage, CapturedImageType } from "./document-image-types";

const run = promisify(execFile);
const MAX_CAPTURED_IMAGES = 40;
const MAX_SINGLE_IMAGE_BYTES = 2_500_000;
const MAX_TOTAL_IMAGE_BYTES = 12_000_000;
/** Full-page scan threshold (px). Scanned PDFs embed entire pages as huge rasters. */
const FULL_PAGE_MIN_EDGE = 1200;
const FULL_PAGE_MIN_PIXELS = 1_200_000;
/** Decorative crumbs / soft-mask stubs. */
const MIN_FIGURE_PIXELS = 12_000;
const MIN_FIGURE_BYTES = 8_000;

export interface ImageCaptureResult {
  images: CapturedDocumentImage[];
  warning?: string;
  skippedFullPageScans?: number;
}

export interface ImageCaptureContext {
  pageCount?: number;
  pageParagraphCounts?: number[];
  totalParagraphs?: number;
  /** When true, drop full-page rasters (they are OCR sources, not figures). */
  ocr?: boolean;
}

interface ImageAnchor {
  path: string;
  paragraphIndex?: number;
  ratio?: number;
}

function typeFromExtension(filename: string): CapturedImageType | null {
  const ext = extname(filename).toLowerCase().replace(".", "");
  if (ext === "jpeg") return "jpg";
  if (ext === "png" || ext === "jpg" || ext === "gif" || ext === "bmp") return ext;
  return null;
}

function typeFromMagic(buffer: Buffer): CapturedImageType | null {
  if (hasMagicBytes(buffer, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (hasMagicBytes(buffer, [0xff, 0xd8, 0xff])) return "jpg";
  if (hasMagicBytes(buffer, [0x47, 0x49, 0x46])) return "gif";
  if (hasMagicBytes(buffer, [0x42, 0x4d])) return "bmp";
  return null;
}

function imageDimensions(type: CapturedImageType, buffer: Buffer) {
  if (type === "png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (type === "gif" && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (type === "bmp" && buffer.length >= 26) {
    return {
      width: Math.abs(buffer.readInt32LE(18)),
      height: Math.abs(buffer.readInt32LE(22)),
    };
  }
  if (type === "jpg") {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      if (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3 ||
        marker === 0xc5 ||
        marker === 0xc6 ||
        marker === 0xc7 ||
        marker === 0xc9 ||
        marker === 0xca ||
        marker === 0xcb ||
        marker === 0xcd ||
        marker === 0xce ||
        marker === 0xcf
      ) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }
  return {};
}

function pageFromPdfImageName(filename: string): number | undefined {
  const match = /-(\d+)-\d+\.(?:png|jpe?g)$/i.exec(filename);
  if (!match) return undefined;
  const page = Number(match[1]);
  return Number.isFinite(page) && page > 0 ? page : undefined;
}

function makeImage(
  buffer: Buffer,
  filename: string,
  source: CapturedDocumentImage["source"],
  index: number,
  anchor?: Pick<CapturedDocumentImage, "anchorParagraphIndex" | "anchorRatio" | "page">
): CapturedDocumentImage | null {
  if (buffer.length === 0 || buffer.length > MAX_SINGLE_IMAGE_BYTES) return null;
  const type = typeFromMagic(buffer) ?? typeFromExtension(filename);
  if (!type) return null;
  const dimensions = imageDimensions(type, buffer);
  return {
    id: `${source}-${index + 1}`,
    filename,
    type,
    data: buffer.toString("base64"),
    bytes: buffer.length,
    source,
    page: anchor?.page ?? (source === "pdf" ? pageFromPdfImageName(filename) : undefined),
    anchorParagraphIndex: anchor?.anchorParagraphIndex,
    anchorRatio: anchor?.anchorRatio,
    ...dimensions,
  };
}

function isFullPageScan(image: CapturedDocumentImage): boolean {
  const w = image.width ?? 0;
  const h = image.height ?? 0;
  if (w > 0 && h > 0) {
    const pixels = w * h;
    if (pixels >= FULL_PAGE_MIN_PIXELS) return true;
    if (Math.min(w, h) >= FULL_PAGE_MIN_EDGE && Math.max(w, h) >= FULL_PAGE_MIN_EDGE) return true;
    // Near A4/letter aspect at high res
    const ratio = w / h;
    if (pixels >= 800_000 && ratio > 0.65 && ratio < 0.85) return true;
  }
  // Huge file without dimension metadata — treat as page scan
  if (image.bytes >= 400_000 && (!image.width || !image.height)) return true;
  return false;
}

function isTinyOrDecorative(image: CapturedDocumentImage): boolean {
  if (image.bytes < MIN_FIGURE_BYTES) return true;
  const w = image.width ?? 0;
  const h = image.height ?? 0;
  if (w > 0 && h > 0 && w * h < MIN_FIGURE_PIXELS) return true;
  return false;
}

function limitImages(images: CapturedDocumentImage[]) {
  const selected: CapturedDocumentImage[] = [];
  let totalBytes = 0;
  for (const image of images) {
    if (selected.length >= MAX_CAPTURED_IMAGES) break;
    if (totalBytes + image.bytes > MAX_TOTAL_IMAGE_BYTES) break;
    selected.push(image);
    totalBytes += image.bytes;
  }
  return selected;
}

/**
 * Prefer real figures over full-page page scans / soft masks.
 * For OCR scans, page rasters must never reappear as "figures" in the Thai book.
 */
function filterExportableImages(
  images: CapturedDocumentImage[],
  context: ImageCaptureContext
): { images: CapturedDocumentImage[]; skippedFullPageScans: number } {
  let skippedFullPageScans = 0;
  const kept: CapturedDocumentImage[] = [];

  // Soft-mask pairs: same page, nearly identical dimensions — keep the larger (color) file only
  const byPage = new Map<number, CapturedDocumentImage[]>();
  for (const image of images) {
    if (isTinyOrDecorative(image)) continue;
    if (isFullPageScan(image)) {
      skippedFullPageScans += 1;
      // OCR documents: never export page scans as figures
      if (context.ocr) continue;
      // Digital PDFs that only contain full-page art (rare): also skip — text is the product
      continue;
    }
    const page = image.page ?? 0;
    const list = byPage.get(page) ?? [];
    list.push(image);
    byPage.set(page, list);
  }

  for (const [, list] of byPage) {
    // Deduplicate near-identical soft masks on the same page
    list.sort((a, b) => b.bytes - a.bytes);
    const seen: CapturedDocumentImage[] = [];
    for (const candidate of list) {
      const dup = seen.some(
        (s) =>
          Math.abs((s.width ?? 0) - (candidate.width ?? 0)) <= 4 &&
          Math.abs((s.height ?? 0) - (candidate.height ?? 0)) <= 4 &&
          Math.abs(s.bytes - candidate.bytes) < Math.max(s.bytes, candidate.bytes) * 0.15
      );
      if (!dup) seen.push(candidate);
    }
    kept.push(...seen);
  }

  // Images without page grouping
  if (byPage.size === 0) {
    for (const image of images) {
      if (isTinyOrDecorative(image) || isFullPageScan(image)) {
        if (isFullPageScan(image)) skippedFullPageScans += 1;
        continue;
      }
      kept.push(image);
    }
  }

  return { images: limitImages(kept), skippedFullPageScans };
}

function readXmlAttributes(tag: string) {
  const attrs = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs.set(match[1], match[2]);
  }
  return attrs;
}

function docxTargetPath(target: string) {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  return posix.normalize(posix.join("word", target));
}

async function docxRelationshipMap(zip: JSZip) {
  const rels = await zip.file("word/_rels/document.xml.rels")?.async("string");
  const map = new Map<string, string>();
  if (!rels) return map;

  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const attrs = readXmlAttributes(match[0]);
    const type = attrs.get("Type") ?? "";
    const id = attrs.get("Id");
    const target = attrs.get("Target");
    if (!id || !target || !type.endsWith("/image")) continue;
    map.set(id, docxTargetPath(target));
  }
  return map;
}

function paragraphText(paragraphXml: string) {
  return Array.from(paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => match[1])
    .join("")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

async function docxImageAnchors(zip: JSZip): Promise<ImageAnchor[]> {
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) return [];

  const rels = await docxRelationshipMap(zip);
  const paragraphMatches = Array.from(documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g));
  const rawAnchors: Array<{ path: string; paragraphIndex: number }> = [];
  let paragraphIndex = 0;

  for (const match of paragraphMatches) {
    const paragraphXml = match[0];
    const hasText = paragraphText(paragraphXml).length > 0;
    const anchorIndex = hasText ? paragraphIndex : Math.max(paragraphIndex - 1, 0);
    const relationshipIds = Array.from(paragraphXml.matchAll(/r:embed="([^"]+)"/g))
      .map((embed) => embed[1]);

    for (const relationshipId of relationshipIds) {
      const path = rels.get(relationshipId);
      if (path && zip.file(path)) {
        rawAnchors.push({ path, paragraphIndex: anchorIndex });
      }
    }

    if (hasText) paragraphIndex += 1;
  }

  return rawAnchors.map((anchor) => ({
    path: anchor.path,
    paragraphIndex: anchor.paragraphIndex,
    ratio: paragraphIndex > 1 ? clamp(anchor.paragraphIndex / (paragraphIndex - 1), 0, 1) : 0,
  }));
}

async function extractDocxImages(buffer: Buffer): Promise<CapturedDocumentImage[]> {
  const zip = await JSZip.loadAsync(buffer);
  const anchors = await docxImageAnchors(zip);

  if (anchors.length > 0) {
    const images: CapturedDocumentImage[] = [];
    for (const anchor of anchors) {
      const file = zip.file(anchor.path);
      if (!file) continue;
      const imageBuffer = await file.async("nodebuffer");
      const image = makeImage(
        imageBuffer,
        anchor.path.split("/").pop() ?? anchor.path,
        "docx",
        images.length,
        {
          anchorParagraphIndex: anchor.paragraphIndex,
          anchorRatio: anchor.ratio,
        }
      );
      if (image) images.push(image);
    }
    return limitImages(images);
  }

  const mediaFiles = Object.values(zip.files)
    .filter((file) => !file.dir && file.name.startsWith("word/media/"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const images: CapturedDocumentImage[] = [];
  for (const file of mediaFiles) {
    const imageBuffer = await file.async("nodebuffer");
    const image = makeImage(imageBuffer, file.name.split("/").pop() ?? file.name, "docx", images.length);
    if (image) images.push(image);
  }
  return limitImages(images);
}

async function extractPdfImages(
  buffer: Buffer,
  signal?: AbortSignal,
  context: ImageCaptureContext = {}
): Promise<CapturedDocumentImage[]> {
  const dir = await mkdtemp(join(tmpdir(), "thai-pdf-images-"));
  try {
    const input = join(dir, "input.pdf");
    const prefix = join(dir, "figure");
    await writeFile(input, buffer);
    await run("pdfimages", ["-f", "1", "-l", "40", "-png", "-j", "-p", input, prefix], {
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
      signal,
    });
    const filenames = (await readdir(dir))
      .filter((name) => /^figure-.*\.(png|jpe?g)$/i.test(name))
      .sort();

    const images: CapturedDocumentImage[] = [];
    for (const filename of filenames) {
      const imageBuffer = await readFile(join(dir, filename));
      const page = pageFromPdfImageName(filename);
      const paragraphIndex = pdfPageParagraphIndex(page, context);
      const image = makeImage(imageBuffer, filename, "pdf", images.length, {
        page,
        anchorParagraphIndex: paragraphIndex,
        anchorRatio: pdfAnchorRatio(page, paragraphIndex, context),
      });
      if (image) images.push(image);
    }
    return limitImages(images);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function pdfPageParagraphIndex(page: number | undefined, context: ImageCaptureContext) {
  if (!page || !context.pageParagraphCounts?.length) return undefined;
  return context.pageParagraphCounts
    .slice(0, Math.max(0, page - 1))
    .reduce((sum, count) => sum + Math.max(0, count), 0);
}

function pdfAnchorRatio(
  page: number | undefined,
  paragraphIndex: number | undefined,
  context: ImageCaptureContext
) {
  if (
    typeof paragraphIndex === "number" &&
    typeof context.totalParagraphs === "number" &&
    context.totalParagraphs > 1
  ) {
    return clamp(paragraphIndex / (context.totalParagraphs - 1), 0, 1);
  }
  if (!page || !context.pageCount || context.pageCount <= 1) return undefined;
  return clamp((page - 1) / (context.pageCount - 1), 0, 1);
}

export async function captureDocumentImages(
  type: SupportedType,
  buffer: Buffer,
  signal?: AbortSignal,
  context: ImageCaptureContext = {}
): Promise<ImageCaptureResult> {
  try {
    let raw: CapturedDocumentImage[] = [];
    if (type === "docx") {
      raw = await extractDocxImages(buffer);
    } else if (type === "pdf") {
      raw = await extractPdfImages(buffer, signal, context);
    } else if (type === "png" || type === "jpg") {
      const image = makeImage(buffer, `uploaded.${type}`, "upload", 0);
      raw = image ? [image] : [];
    }

    const { images, skippedFullPageScans } = filterExportableImages(raw, context);
    const warnings: string[] = [];
    if (skippedFullPageScans > 0) {
      warnings.push(
        context.ocr
          ? `Skipped ${skippedFullPageScans} full-page scan image(s) (used only for OCR, not re-inserted as figures).`
          : `Skipped ${skippedFullPageScans} full-page image(s) that look like page scans rather than figures.`
      );
    }
    if (raw.length > 0 && images.length === 0) {
      warnings.push(
        "No standalone figures were found. For scanned PDFs this is expected — only the OCR text is exported."
      );
    }
    return {
      images,
      skippedFullPageScans,
      warning: warnings.length ? warnings.join(" ") : undefined,
    };
  } catch (error) {
    console.warn("image capture failed:", error);
    return {
      images: [],
      warning: "Text was extracted, but images could not be captured from this file.",
    };
  }
}
