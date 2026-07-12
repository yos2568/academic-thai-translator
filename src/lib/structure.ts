/**
 * Lightweight document structure detection for textbook-style DOCX export.
 * Operates on plain text (source or Thai translation) without LLM calls.
 */

export type BlockKind = "title" | "h1" | "h2" | "h3" | "paragraph" | "list" | "caption" | "quote";

export interface TextBlock {
  kind: BlockKind;
  text: string;
}

const HEADING_NUMBERED =
  /^(?:chapter|part|section|unit|บทที่|ตอนที่|ส่วนที่|หัวข้อ)\s*[\d๐-๙ivxlcdm.]+/i;
const HEADING_MARKDOWN = /^(#{1,3})\s+(.+)$/;
const LIST_ITEM = /^(?:[-*•]|\d+[.)]|[๑-๙]+[.)])\s+\S/;
const CAPTION =
  /^(?:figure|fig\.|table|ภาพที่|รูปที่|ตารางที่)\s*[\d๐-๙]+/i;
const ALL_CAPS_LATIN = /^[A-Z0-9][A-Z0-9\s,;:'"()\-]{2,80}$/;

function isLikelyHeading(line: string): BlockKind | null {
  const t = line.trim();
  if (!t || t.length > 120) return null;
  if (/[.!?…]$/.test(t) && t.length > 40) return null;

  const md = t.match(HEADING_MARKDOWN);
  if (md) {
    const level = md[1].length;
    return level === 1 ? "h1" : level === 2 ? "h2" : "h3";
  }
  if (HEADING_NUMBERED.test(t)) return "h1";
  if (/^\d+(?:\.\d+){0,2}\s+\S/.test(t) && t.length < 90) {
    const dots = (t.match(/\./g) || []).length;
    return dots >= 2 ? "h3" : dots === 1 ? "h2" : "h1";
  }
  if (ALL_CAPS_LATIN.test(t) && t.split(/\s+/).length <= 12) return "h2";
  // Short Thai/English line without sentence punctuation → section-ish heading
  if (t.length <= 48 && !/[.!?…]$/.test(t) && !LIST_ITEM.test(t) && t.split(/\s+/).length <= 10) {
    // Only treat as heading when it looks like a title case / standalone label
    if (/^[A-Z\u0E00-\u0E7F]/.test(t) && !/[,;:]/.test(t.slice(-1))) {
      return null; // too aggressive for body — leave as paragraph unless stronger signal
    }
  }
  return null;
}

function stripMarkdownHeading(text: string): string {
  return text.replace(/^#{1,3}\s+/, "").trim();
}

/**
 * Split plain text into structural blocks for export styling.
 * First non-empty block is treated as title when it is short.
 */
export function parseDocumentBlocks(text: string): TextBlock[] {
  const chunks = text
    .replace(/\r\n?/g, "\n")
    // Image markers are handled by the exporter, not as prose blocks.
    .replace(/\[\[IMG:[A-Za-z0-9._-]+\]\]/g, "")
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);

  if (chunks.length === 0) return [];

  const blocks: TextBlock[] = [];
  chunks.forEach((chunk, index) => {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    // Multi-line list block
    if (lines.length > 1 && lines.every((l) => LIST_ITEM.test(l) || l.length < 120)) {
      const allList = lines.filter((l) => LIST_ITEM.test(l));
      if (allList.length === lines.length) {
        for (const line of lines) {
          blocks.push({ kind: "list", text: line.replace(/^(?:[-*•]|\d+[.)]|[๑-๙]+[.)])\s+/, "") });
        }
        return;
      }
    }

    const single = lines.join(" ").replace(/\s+/g, " ").trim();
    if (!single) return;

    if (CAPTION.test(single)) {
      blocks.push({ kind: "caption", text: single });
      return;
    }

    if (LIST_ITEM.test(single) && lines.length === 1) {
      blocks.push({
        kind: "list",
        text: single.replace(/^(?:[-*•]|\d+[.)]|[๑-๙]+[.)])\s+/, ""),
      });
      return;
    }

    if (single.startsWith(">") || single.startsWith("“") || single.startsWith('"')) {
      blocks.push({ kind: "quote", text: single.replace(/^>\s*/, "").trim() });
      return;
    }

    const heading = isLikelyHeading(lines[0]);
    if (heading && (lines.length === 1 || lines[0].length < 80)) {
      const headingText = stripMarkdownHeading(lines[0]);
      // First short heading-like block → document title
      if (index === 0 && headingText.length <= 100 && blocks.length === 0) {
        blocks.push({ kind: "title", text: headingText });
        if (lines.length > 1) {
          blocks.push({ kind: "paragraph", text: lines.slice(1).join(" ") });
        }
        return;
      }
      blocks.push({ kind: heading, text: headingText });
      if (lines.length > 1) {
        blocks.push({ kind: "paragraph", text: lines.slice(1).join(" ") });
      }
      return;
    }

    // First short chunk without terminal punctuation → title
    if (
      index === 0 &&
      blocks.length === 0 &&
      single.length <= 100 &&
      !/[.!?…]$/.test(single) &&
      lines.length === 1
    ) {
      blocks.push({ kind: "title", text: single });
      return;
    }

    blocks.push({ kind: "paragraph", text: single });
  });

  return blocks;
}
