import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from "docx";
import type { CapturedDocumentImage, CapturedImageType } from "./document-image-types";
import { parseDocumentBlocks, type BlockKind, type TextBlock } from "./structure";
import { splitByImageMarkers } from "./image-markers";
import { clamp } from "./util";

/** Thai academic / textbook conventions (TH SarabunPSK). */
const THAI_FONT = "TH SarabunPSK";
const BODY_SIZE = 32; // 16pt in half-points
const H1_SIZE = 36;
const H2_SIZE = 34;
const H3_SIZE = 32;
const TITLE_SIZE = 44;
const CAPTION_SIZE = 28;
const MAX_EXPORT_IMAGES = 40;
const MAX_EXPORT_IMAGE_BYTES = 2_500_000;
const MAX_IMAGE_WIDTH = 420;
const MAX_IMAGE_HEIGHT = 520;

export interface TextbookMeta {
  title?: string;
  author?: string;
  subject?: string;
  /** When true, first detected title block is used as document title. */
  useDetectedTitle?: boolean;
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
          size: CAPTION_SIZE,
          italics: true,
        }),
      ],
      spacing: { before: 200, after: 80 },
      alignment: AlignmentType.CENTER,
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
      spacing: { after: 280 },
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

function headingLevel(kind: BlockKind) {
  if (kind === "h1" || kind === "title") return HeadingLevel.HEADING_1;
  if (kind === "h2") return HeadingLevel.HEADING_2;
  if (kind === "h3") return HeadingLevel.HEADING_3;
  return undefined;
}

function blockToParagraph(block: TextBlock): Paragraph {
  if (block.kind === "title") {
    return new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 360, line: 360, lineRule: LineRuleType.AUTO },
      children: [
        new TextRun({
          text: block.text,
          font: THAI_FONT,
          size: TITLE_SIZE,
          bold: true,
        }),
      ],
    });
  }

  if (block.kind === "h1" || block.kind === "h2" || block.kind === "h3") {
    const size = block.kind === "h1" ? H1_SIZE : block.kind === "h2" ? H2_SIZE : H3_SIZE;
    return new Paragraph({
      heading: headingLevel(block.kind),
      spacing: { before: 280, after: 160, line: 360, lineRule: LineRuleType.AUTO },
      children: [
        new TextRun({
          text: block.text,
          font: THAI_FONT,
          size,
          bold: true,
        }),
      ],
    });
  }

  if (block.kind === "list") {
    return new Paragraph({
      spacing: { after: 120, line: 360, lineRule: LineRuleType.AUTO },
      indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.2) },
      children: [
        new TextRun({ text: `• ${block.text}`, font: THAI_FONT, size: BODY_SIZE }),
      ],
    });
  }

  if (block.kind === "caption") {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 200, line: 360, lineRule: LineRuleType.AUTO },
      children: [
        new TextRun({
          text: block.text,
          font: THAI_FONT,
          size: CAPTION_SIZE,
          italics: true,
        }),
      ],
    });
  }

  if (block.kind === "quote") {
    return new Paragraph({
      spacing: { before: 120, after: 200, line: 360, lineRule: LineRuleType.AUTO },
      indent: { left: convertInchesToTwip(0.4), right: convertInchesToTwip(0.3) },
      border: {
        left: { style: BorderStyle.SINGLE, size: 12, color: "94A3B8", space: 10 },
      },
      children: [
        new TextRun({
          text: block.text,
          font: THAI_FONT,
          size: BODY_SIZE,
          italics: true,
        }),
      ],
    });
  }

  // Body paragraph — Thai distribute + first-line indent (textbook feel)
  return new Paragraph({
    spacing: { after: 200, line: 360, lineRule: LineRuleType.AUTO },
    indent: { firstLine: convertInchesToTwip(0.35) },
    alignment: AlignmentType.THAI_DISTRIBUTE,
    children: [
      new TextRun({ text: block.text, font: THAI_FONT, size: BODY_SIZE }),
    ],
  });
}

function metaParagraphs(meta: TextbookMeta, detectedTitle?: string): Paragraph[] {
  const paras: Paragraph[] = [];
  const title = meta.title?.trim() || (meta.useDetectedTitle === false ? undefined : detectedTitle);
  // When blocks already include a title, we only add author/subject here.
  if (meta.author?.trim()) {
    paras.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: meta.author.trim(),
            font: THAI_FONT,
            size: 28,
            italics: true,
          }),
        ],
      })
    );
  }
  if (meta.subject?.trim()) {
    paras.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 320 },
        children: [
          new TextRun({
            text: meta.subject.trim(),
            font: THAI_FONT,
            size: 26,
            color: "475569",
          }),
        ],
      })
    );
  } else if (title && meta.author?.trim()) {
    // spacing after author when no subject
  }
  return paras;
}

function blocksToParagraphs(blocks: TextBlock[], meta: TextbookMeta): Paragraph[] {
  const contentParas: Paragraph[] = [];
  for (const block of blocks) {
    if (block.kind === "title" && meta.title?.trim()) {
      contentParas.push(
        new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 360, line: 360, lineRule: LineRuleType.AUTO },
          children: [
            new TextRun({
              text: meta.title.trim(),
              font: THAI_FONT,
              size: TITLE_SIZE,
              bold: true,
            }),
          ],
        })
      );
      continue;
    }
    contentParas.push(blockToParagraph(block));
  }
  return contentParas;
}

export async function buildDocx(
  thaiText: string,
  title: string,
  images: CapturedDocumentImage[] = [],
  meta: TextbookMeta = {}
): Promise<Buffer> {
  const imageById = new Map(usableImages(images).map((img) => [img.id, img]));
  const placedIds = new Set<string>();
  let figureIndex = 0;

  const segments = splitByImageMarkers(thaiText);
  const hasMarkers = segments.some((s) => s.type === "image");
  const plainForStructure = segments
    .filter((s): s is { type: "text"; value: string } => s.type === "text")
    .map((s) => s.value)
    .join("\n\n");
  const structureSample = parseDocumentBlocks(plainForStructure || thaiText);
  const hasStructuredTitle = structureSample.some((b) => b.kind === "title");
  const displayTitle = meta.title?.trim() || title;

  const contentParas: Paragraph[] = [];

  if (!hasStructuredTitle && displayTitle) {
    contentParas.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: displayTitle, font: THAI_FONT, size: TITLE_SIZE, bold: true }),
        ],
        spacing: { after: 200 },
      })
    );
  }

  contentParas.push(
    ...metaParagraphs(meta, structureSample.find((b) => b.kind === "title")?.text)
  );

  if (hasMarkers) {
    for (const segment of segments) {
      if (segment.type === "text") {
        const text = segment.value.trim();
        if (!text) continue;
        const blocks = parseDocumentBlocks(text);
        if (blocks.length === 0) {
          contentParas.push(
            new Paragraph({
              children: [new TextRun({ text, font: THAI_FONT, size: BODY_SIZE })],
              spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 200 },
              alignment: AlignmentType.THAI_DISTRIBUTE,
              indent: { firstLine: convertInchesToTwip(0.35) },
            })
          );
        } else {
          contentParas.push(...blocksToParagraphs(blocks, meta));
        }
      } else {
        const image = imageById.get(segment.id);
        if (!image) continue;
        placedIds.add(segment.id);
        contentParas.push(...imageParagraphs(image, figureIndex++));
      }
    }
  } else {
    const blocks = parseDocumentBlocks(thaiText);
    if (blocks.length === 0) {
      contentParas.push(
        new Paragraph({
          children: [new TextRun({ text: thaiText, font: THAI_FONT, size: BODY_SIZE })],
          spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 200 },
          alignment: AlignmentType.THAI_DISTRIBUTE,
          indent: { firstLine: convertInchesToTwip(0.35) },
        })
      );
    } else {
      contentParas.push(...blocksToParagraphs(blocks, meta));
    }
  }

  // Fallback: any images not referenced by markers (legacy exports / lost markers)
  const unplaced = usableImages(images).filter((img) => !placedIds.has(img.id));
  const children =
    unplaced.length > 0 && !hasMarkers
      ? interleaveImages(contentParas, unplaced)
      : unplaced.length > 0
        ? [
            ...contentParas,
            ...unplaced.flatMap((image, i) => imageParagraphs(image, figureIndex + i)),
          ]
        : contentParas;

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: THAI_FONT, size: BODY_SIZE },
          paragraph: {
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 200 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            // Thai thesis / textbook margins: 1.5" left, 1" others
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.5),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: displayTitle ? `${displayTitle}  ·  ` : "",
                    font: THAI_FONT,
                    size: 20,
                    color: "64748B",
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: THAI_FONT,
                    size: 20,
                    color: "64748B",
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export function buildTxt(thaiText: string): Buffer {
  // Strip placement markers from plain-text export.
  const clean = thaiText.replace(/\[\[IMG:[A-Za-z0-9._-]+\]\]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  // UTF-8 BOM so Thai text opens correctly in Windows Notepad/Excel.
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(clean, "utf-8")]);
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const safe = base.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "translation";
  return safe.slice(0, 80);
}
