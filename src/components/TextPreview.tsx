"use client";

import Image from "next/image";
import type { CapturedDocumentImage } from "@/lib/document-image-types";

interface TextPreviewProps {
  text: string;
  filename: string;
  images: CapturedDocumentImage[];
  imageWarning?: string;
  onChange: (text: string) => void;
  onTranslate: () => void;
  onBack: () => void;
  usedOcr?: boolean;
}

function imageSrc(image: CapturedDocumentImage) {
  const mime = image.type === "jpg" ? "image/jpeg" : `image/${image.type}`;
  return `data:${mime};base64,${image.data}`;
}

export default function TextPreview({
  text,
  filename,
  images,
  imageWarning,
  onChange,
  onTranslate,
  onBack,
  usedOcr,
}: TextPreviewProps) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            {usedOcr ? "Review OCR text" : "Review extracted text"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {filename} · {text.length.toLocaleString()} characters — edit to
            remove headers, footers, or anything you don&apos;t want translated
          </p>
          {usedOcr && <p className="mt-2 text-sm font-medium text-amber-700">This file was read with OCR. Correct any recognition errors before translating.</p>}
          {imageWarning && <p className="mt-2 text-sm font-medium text-amber-700">{imageWarning}</p>}
        </div>
      </div>
      {images.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-700">
              Captured images
            </h3>
            <span className="text-xs font-medium text-slate-500">
              {images.length} will be included in the Word export
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.slice(0, 8).map((image, index) => (
              <figure
                key={image.id}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white"
              >
                <Image
                  src={imageSrc(image)}
                  alt={image.page ? `Captured image ${index + 1} from page ${image.page}` : `Captured image ${index + 1}`}
                  width={160}
                  height={112}
                  unoptimized
                  className="h-28 w-full object-contain"
                />
                <figcaption className="truncate border-t border-slate-100 px-2 py-1 text-xs text-slate-500">
                  {image.page
                    ? `Page ${image.page}`
                    : typeof image.anchorParagraphIndex === "number"
                      ? `Near paragraph ${image.anchorParagraphIndex + 1}`
                      : image.filename}
                </figcaption>
              </figure>
            ))}
          </div>
          {images.length > 8 && (
            <p className="mt-2 text-xs text-slate-500">
              Showing 8 previews. All captured images will be kept for Word export.
            </p>
          )}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="h-96 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
      <div className="mt-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
        >
          ← Choose another file
        </button>
        <button
          onClick={onTranslate}
          disabled={!text.trim()}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Translate to Thai →
        </button>
      </div>
    </div>
  );
}
