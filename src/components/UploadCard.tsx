"use client";

import { useCallback } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";

const MAX_SIZE = 50 * 1024 * 1024;
const MAX_SIZE_LABEL = `${MAX_SIZE / (1024 * 1024)} MB`;
const ACCEPT = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
} as const;

interface UploadCardProps {
  onFile: (file: File) => void;
  onError: (message: string) => void;
  busy: boolean;
  onCancel: () => void;
  progress: { percent: number; message: string };
}

export default function UploadCard({
  onFile,
  onError,
  busy,
  onCancel,
  progress,
}: UploadCardProps) {
  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        const code = rejected[0].errors[0]?.code;
        onError(
          code === "file-too-large"
            ? `File is too large. The maximum size is ${MAX_SIZE_LABEL}.`
            : "Please upload a .docx, .pdf, .txt, .png, or .jpg file."
        );
        return;
      }
      if (accepted[0]) onFile(accepted[0]);
    },
    [onFile, onError]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    maxSize: MAX_SIZE,
    disabled: busy,
    noClick: true, // use explicit button so clicks always work
    noKeyboard: true,
    accept: ACCEPT,
  });

  return (
    <div
      {...getRootProps()}
      className={
        "rounded-2xl border-2 border-dashed bg-white p-12 text-center shadow-sm transition-colors " +
        (isDragActive ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-blue-400") +
        (busy ? " opacity-70" : "")
      }
    >
      <input {...getInputProps()} />
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
        <svg
          className="h-7 w-7"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
          />
        </svg>
      </div>
      <p className="mt-4 text-base font-medium text-slate-700">
        {busy
          ? progress.message
          : isDragActive
            ? "Drop your document here"
            : "Drag & drop your English document"}
      </p>
      <p className="mt-2 text-sm text-slate-500">
        {busy
          ? "Scanned PDFs use OCR and may take a few minutes."
          : `Supported formats — max ${MAX_SIZE_LABEL}`}
      </p>

      {!busy && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            open();
          }}
          className="mt-5 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          Choose file
        </button>
      )}

      {busy && (
        <div className="mx-auto mt-5 max-w-md">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Processing document</span>
            <span>{Math.round(progress.percent)}%</span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-label="Document processing progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.percent)}
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}
      {busy && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }}
          className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      )}
      <div className={`${busy ? "mt-3" : "mt-4"} flex justify-center gap-2`}>
        {[".docx", ".pdf", ".txt", ".png", ".jpg"].map((ext) => (
          <span
            key={ext}
            className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500"
          >
            {ext}
          </span>
        ))}
      </div>
    </div>
  );
}
