import { NextRequest, NextResponse } from "next/server";
import { buildDocx, buildTxt, sanitizeFilename } from "@/lib/exporter";
import type { CapturedDocumentImage, CapturedImageType } from "@/lib/document-images";

export const runtime = "nodejs";

const MAX_EXPORT_CHARS = 2_000_000;
const MAX_EXPORT_BODY_BYTES = 18_000_000;
const MAX_EXPORT_IMAGES = 24;
const MAX_SINGLE_IMAGE_BYTES = 2_500_000;
const IMAGE_TYPES: CapturedImageType[] = ["png", "jpg", "gif", "bmp"];

function parseImages(value: unknown): CapturedDocumentImage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_EXPORT_IMAGES).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const image = item as Record<string, unknown>;
    const type = typeof image.type === "string" ? image.type : "";
    const data = typeof image.data === "string" ? image.data : "";
    const bytes = typeof image.bytes === "number" ? image.bytes : 0;
    if (!IMAGE_TYPES.includes(type as CapturedImageType)) return [];
    if (bytes <= 0 || bytes > MAX_SINGLE_IMAGE_BYTES) return [];
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) return [];
    return [
      {
        id: typeof image.id === "string" ? image.id : `image-${index + 1}`,
        filename: typeof image.filename === "string" ? image.filename.slice(0, 120) : `image-${index + 1}.${type}`,
        type: type as CapturedImageType,
        data,
        bytes,
        source: image.source === "docx" || image.source === "pdf" || image.source === "upload" ? image.source : "upload",
        page: typeof image.page === "number" ? image.page : undefined,
        anchorParagraphIndex: typeof image.anchorParagraphIndex === "number" ? image.anchorParagraphIndex : undefined,
        anchorRatio: typeof image.anchorRatio === "number" ? image.anchorRatio : undefined,
        width: typeof image.width === "number" ? image.width : undefined,
        height: typeof image.height === "number" ? image.height : undefined,
      } satisfies CapturedDocumentImage,
    ];
  });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_EXPORT_BODY_BYTES) {
    return NextResponse.json({ error: "Export request is too large." }, { status: 413 });
  }
  let body: {
    text?: unknown;
    format?: unknown;
    filename?: unknown;
    images?: unknown;
    title?: unknown;
    author?: unknown;
    subject?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const format = body.format === "docx" ? "docx" : body.format === "txt" ? "txt" : null;
  const filename = sanitizeFilename(
    typeof body.filename === "string" ? body.filename : "translation"
  );
  const images = parseImages(body.images);
  const textbookMeta = {
    title: typeof body.title === "string" ? body.title.slice(0, 200) : undefined,
    author: typeof body.author === "string" ? body.author.slice(0, 120) : undefined,
    subject: typeof body.subject === "string" ? body.subject.slice(0, 120) : undefined,
  };

  if (!text) {
    return NextResponse.json({ error: "Nothing to export." }, { status: 400 });
  }
  if (!format) {
    return NextResponse.json(
      { error: 'Format must be "docx" or "txt".' },
      { status: 400 }
    );
  }
  if (text.length > MAX_EXPORT_CHARS) {
    return NextResponse.json({ error: "Document is too large to export." }, { status: 413 });
  }

  try {
    const buffer =
      format === "docx" ? await buildDocx(text, filename, images, textbookMeta) : buildTxt(text);

    const contentType =
      format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "text/plain; charset=utf-8";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="translation.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}.${format}`,
      },
    });
  } catch (err) {
    console.error("export failed:", err);
    return NextResponse.json(
      { error: "Could not generate the export file." },
      { status: 500 }
    );
  }
}
