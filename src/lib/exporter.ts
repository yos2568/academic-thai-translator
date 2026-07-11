import "server-only";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { CapturedDocumentImage, CapturedImageType } from "./document-images";

/** Thai academic document conventions: TH SarabunPSK 16pt body, 1.5 line spacing. */
const THAI_FONT = "TH SarabunPSK";
const BODY_SIZE_HALF_POINTS = 32; // 16pt
const MAX_EXPORT_IMAGES = 24;
const MAX_EXPORT_IMAGE_BYTES = 2_500_000;
const MAX_IMAGE_WIDTH = 420;
const MAX_IMAGE_HEIGHT = 520;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function scaledDimensions(image: CapturedDocumentImage) {
  const width = image.width && image.width > 0 ? image.width : MAX_IMAGE_WIDTH;
  const height = image.height && image.height > 0 ? image.height : MAX_IMAGE_HEIGHT;
  const scale = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function usableImages(images: CapturedDocumentImage[]) {
  const supportedTypes: CapturedImageType[] = ["png", "jpg", "gif", "bmp"];
  return images
    .filter(
      (image) =>
        supportedTypes.includes(image.type) &&
        image.bytes > 0 &&
        image.bytes <= MAX_EXPORT_IMAGE_BYTES &&
        /^[A-Za-z0-9+/=]+$/.test(image.data)
    )
    .slice(0, MAX_EXPORT_IMAGES);
}

function imageParagraphs(image: CapturedDocumentImage, index: number) {
  const dimensions = scaledDimensions(image);
  const label = image.page
    ? `ภาพที่ ${index + 1} จากหน้า ${image.page}`
    : `ภาพที่ ${index + 1}`;

  return [
    new Paragraph({
      children: [
        new TextRun({
          text: label,
          font: THAI_FONT,
          size: 28,
          italics: true,
        }),
      ],
      spacing: { before: 120, after: 80 },
    }),
    new Paragraph({
      children: [
        new ImageRun({
          type: image.type,
          data: Buffer.from(image.data, "base64"),
          transformation: dimensions,
          altText: {
            title: label,
            description: image.filename,
            name: image.filename,
          },
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
    }),
  ];
}

function insertionIndex(image: CapturedDocumentImage, paragraphCount: number) {
  if (paragraphCount <= 0) return 0;
  if (typeof image.anchorParagraphIndex === "number") {
    return clamp(Math.round(image.anchorParagraphIndex), 0, paragraphCount - 1);
  }
  if (typeof image.anchorRatio === "number") {
    return clamp(Math.round(image.anchorRatio * (paragraphCount - 1)), 0, paragraphCount - 1);
  }
  return paragraphCount - 1;
}

function interleaveImages(
  paragraphs: Paragraph[],
  images: CapturedDocumentImage[]
): Paragraph[] {
  const validImages = usableImages(images);
  if (validImages.length === 0) return paragraphs;

  const grouped = new Map<number, Array<{ image: CapturedDocumentImage; index: number }>>();
  validImages.forEach((image, index) => {
    const insertAfter = insertionIndex(image, paragraphs.length);
    const group = grouped.get(insertAfter) ?? [];
    group.push({ image, index });
    grouped.set(insertAfter, group);
  });

  if (paragraphs.length === 0) {
    return validImages.flatMap((image, index) => imageParagraphs(image, index));
  }

  const output: Paragraph[] = [];
  paragraphs.forEach((paragraph, index) => {
    output.push(paragraph);
    for (const anchored of grouped.get(index) ?? []) {
      output.push(...imageParagraphs(anchored.image, anchored.index));
    }
  });
  return output;
}

export async function buildDocx(
  thaiText: string,
  title: string,
  images: CapturedDocumentImage[] = []
): Promise<Buffer> {
  const paragraphs = thaiText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        new Paragraph({
          children: [
            new TextRun({ text: p, font: THAI_FONT, size: BODY_SIZE_HALF_POINTS }),
          ],
          spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 200 },
          alignment: AlignmentType.THAI_DISTRIBUTE,
        })
    );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            // Standard Thai thesis margins: 1.5" left, 1" others (in twips)
            margin: { top: 1440, right: 1440, bottom: 1440, left: 2160 },
          },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: title, font: THAI_FONT, size: 40, bold: true }),
            ],
            spacing: { after: 400 },
          }),
          ...interleaveImages(paragraphs, images),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export function buildTxt(thaiText: string): Buffer {
  // UTF-8 BOM so Thai text opens correctly in Windows Notepad/Excel.
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(thaiText, "utf-8")]);
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const safe = base.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "translation";
  return safe.slice(0, 80);
}
