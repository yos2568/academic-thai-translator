/**
 * Stable image placeholders that survive translation and drive DOCX placement.
 * Format: [[IMG:id]]  — kept ASCII so models rarely rewrite it.
 */

export const IMAGE_MARKER_RE = /\[\[IMG:([A-Za-z0-9._-]+)\]\]/g;

export function imageMarker(id: string): string {
  return `[[IMG:${id}]]`;
}

export function stripImageMarkers(text: string): string {
  return text
    .replace(IMAGE_MARKER_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split text into runs of plain text and image ids (in order). */
export function splitByImageMarkers(text: string): Array<{ type: "text"; value: string } | { type: "image"; id: string }> {
  const parts: Array<{ type: "text"; value: string } | { type: "image"; id: string }> = [];
  let last = 0;
  const re = new RegExp(IMAGE_MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", value: text.slice(last, match.index) });
    }
    parts.push({ type: "image", id: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ type: "text", value: text.slice(last) });
  }
  return parts;
}

/**
 * Inject markers into extracted text so figures stay aligned after translation.
 * - Images with a paragraph anchor insert after that paragraph.
 * - Remaining images with a page number insert after that page's last paragraph.
 * - Any leftover markers are appended at the end.
 */
export function injectImageMarkers(
  text: string,
  images: Array<{ id: string; page?: number; anchorParagraphIndex?: number }>,
  pageParagraphCounts?: number[]
): string {
  if (!images.length) return text;

  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length === 0) {
    return text + "\n\n" + images.map((img) => imageMarker(img.id)).join("\n\n");
  }

  const inserts = new Map<number, string[]>();
  const used = new Set<string>();

  const pageStartIndex = (page: number) => {
    if (!pageParagraphCounts?.length) return 0;
    let sum = 0;
    for (let i = 0; i < Math.min(page - 1, pageParagraphCounts.length); i++) {
      sum += Math.max(0, pageParagraphCounts[i]);
    }
    return sum;
  };

  const pageEndIndex = (page: number) => {
    if (!pageParagraphCounts?.length) return paragraphs.length - 1;
    const start = pageStartIndex(page);
    const count = pageParagraphCounts[page - 1] ?? 0;
    return Math.min(paragraphs.length - 1, Math.max(start, start + Math.max(count, 1) - 1));
  };

  for (const image of images) {
    let index: number | undefined;
    if (typeof image.anchorParagraphIndex === "number") {
      index = Math.max(0, Math.min(paragraphs.length - 1, Math.round(image.anchorParagraphIndex)));
    } else if (typeof image.page === "number" && image.page > 0) {
      // Mid-page placement: after first third of the page's paragraphs (typical figure body)
      const start = pageStartIndex(image.page);
      const end = pageEndIndex(image.page);
      index = Math.min(end, start + Math.max(0, Math.floor((end - start) * 0.45)));
    }
    if (index === undefined) continue;
    const list = inserts.get(index) ?? [];
    list.push(imageMarker(image.id));
    inserts.set(index, list);
    used.add(image.id);
  }

  const out: string[] = [];
  paragraphs.forEach((para, i) => {
    out.push(para);
    for (const marker of inserts.get(i) ?? []) {
      out.push(marker);
    }
  });

  for (const image of images) {
    if (!used.has(image.id)) {
      out.push(imageMarker(image.id));
    }
  }

  return out.join("\n\n");
}
