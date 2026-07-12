"use client";

import { useState } from "react";
import type { CapturedDocumentImage } from "@/lib/document-image-types";

interface ExportBarProps {
  thaiText: string;
  filename: string;
  images: CapturedDocumentImage[];
  onRestart: () => void;
  onError: (message: string) => void;
}

export default function ExportBar({
  thaiText,
  filename,
  images,
  onRestart,
  onError,
}: ExportBarProps) {
  const [downloading, setDownloading] = useState<"docx" | "txt" | null>(null);
  const [title, setTitle] = useState(filename.replace(/\.[^.]+$/, "") || "");
  const [author, setAuthor] = useState("");
  const [subject, setSubject] = useState("");

  const download = async (format: "docx" | "txt") => {
    setDownloading(format);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: thaiText,
          format,
          filename: title || filename,
          title: title || undefined,
          author: author || undefined,
          subject: subject || undefined,
          ...(format === "docx" ? { images } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || filename).replace(/\.[^.]+$/, "")}-thai.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div>
        <h2 className="text-base font-semibold text-slate-800">Export Thai textbook layout</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Word export uses TH SarabunPSK, thesis margins, structured headings, figure captions
          {images.length > 0 ? `, and ${images.length} captured image(s)` : ""}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-slate-600 sm:col-span-1">
          ชื่อเรื่อง (Title)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
            placeholder="ชื่อหนังสือ / บท"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          ผู้แต่ง (Author)
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
            placeholder="optional"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          วิชา / หมวด (Subject)
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
            placeholder="optional"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          onClick={onRestart}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
        >
          Translate another
        </button>
        <button
          onClick={() => download("txt")}
          disabled={downloading !== null}
          className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {downloading === "txt" ? "Preparing…" : "Download .txt"}
        </button>
        <button
          onClick={() => download("docx")}
          disabled={downloading !== null}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {downloading === "docx" ? "Preparing…" : "Download textbook .docx"}
        </button>
      </div>
    </div>
  );
}
