"use client";

import { useEffect, useRef, useState } from "react";

interface TranslationPanelProps {
  sourceText: string;
  thaiText: string;
  translating: boolean;
  progress: { chunk: number; total: number } | null;
  stage: "draft" | "postedit" | "qa";
}

export default function TranslationPanel({
  sourceText,
  thaiText,
  translating,
  progress,
  stage,
}: TranslationPanelProps) {
  const outputRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Follow the streaming output.
  useEffect(() => {
    if (translating && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [thaiText, translating]);

  const copy = async () => {
    await navigator.clipboard.writeText(thaiText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const percent =
    progress && progress.total > 0
      ? Math.round(((progress.chunk - 1) / progress.total) * 100)
      : 0;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-800">
          {translating ? stage === "postedit" ? "Polishing academic Thai…" : stage === "qa" ? "Checking fidelity…" : "Creating translation…" : "Translation"}
        </h2>
        {translating && progress ? (
          <span className="text-sm text-slate-400">
            Section {progress.chunk} of {progress.total}
          </span>
        ) : thaiText ? (
          <button
            onClick={copy}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            {copied ? "Copied ✓" : "Copy Thai text"}
          </button>
        ) : null}
      </div>

      {translating && (
        <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${Math.max(percent, 4)}%` }}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="hidden lg:block">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            English source
          </h3>
          <div className="h-[28rem] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-600 whitespace-pre-wrap">
            {sourceText}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Academic Thai
          </h3>
          <div
            ref={outputRef}
            className="thai-text h-[28rem] overflow-y-auto rounded-xl border border-blue-100 bg-white p-4 text-slate-800 whitespace-pre-wrap"
          >
            {thaiText}
            {translating && (
              <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-blue-400 align-text-bottom" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
