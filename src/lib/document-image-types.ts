/** Shared image types safe for client and server imports. */

export type CapturedImageType = "png" | "jpg" | "gif" | "bmp";

export interface CapturedDocumentImage {
  id: string;
  filename: string;
  type: CapturedImageType;
  data: string;
  bytes: number;
  source: "docx" | "pdf" | "upload";
  page?: number;
  anchorParagraphIndex?: number;
  anchorRatio?: number;
  width?: number;
  height?: number;
}
