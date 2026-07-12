import { hasMagicBytes } from "./util";

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_FILE_SIZE_LABEL = `${MAX_FILE_SIZE / (1024 * 1024)} MB`;

export type SupportedType = "docx" | "pdf" | "txt" | "png" | "jpg";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const EXTENSION_MAP: Record<string, SupportedType> = {
  docx: "docx",
  pdf: "pdf",
  txt: "txt",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
};

/**
 * Validates an upload by extension, size, and file signature (magic bytes),
 * so a renamed executable cannot masquerade as a document.
 */
export function validateUpload(filename: string, buffer: Buffer): SupportedType {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const type = EXTENSION_MAP[ext];
  if (!type) {
    throw new ValidationError(
      `Unsupported file type ".${ext}". Please upload a .docx, .pdf, .txt, .png, or .jpg file.`
    );
  }

  if (buffer.length === 0) {
    throw new ValidationError("The uploaded file is empty.");
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new ValidationError(`File is too large. The maximum size is ${MAX_FILE_SIZE_LABEL}.`);
  }

  if (type === "pdf" && !hasMagicBytes(buffer, [0x25, 0x50, 0x44, 0x46])) {
    // %PDF
    throw new ValidationError("This file is not a valid PDF document.");
  }
  if (type === "docx" && !hasMagicBytes(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    // PK\x03\x04 (ZIP container)
    throw new ValidationError("This file is not a valid Word (.docx) document.");
  }
  if (type === "txt") {
    // Reject binary data renamed to .txt: NUL bytes are a strong signal.
    const sample = buffer.subarray(0, 8192);
    if (sample.includes(0)) {
      throw new ValidationError("This file does not appear to be plain text.");
    }
  }
  if (type === "png" && !hasMagicBytes(buffer, [0x89, 0x50, 0x4e, 0x47])) {
    throw new ValidationError("This file is not a valid PNG image.");
  }
  if (type === "jpg" && !hasMagicBytes(buffer, [0xff, 0xd8, 0xff])) {
    throw new ValidationError("This file is not a valid JPEG image.");
  }

  return type;
}
