"use client";

import { useEffect, useId, useState } from "react";

export interface GlossaryTerm {
  english: string;
  thai: string;
}

const STORAGE_KEY = "academic-thai-translator.glossary.v1";
const MAX_TERMS = 100;

function loadPinnedGlossary(): GlossaryTerm[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is GlossaryTerm => typeof item?.english === "string" && typeof item?.thai === "string")
      .slice(0, MAX_TERMS);
  } catch {
    return [];
  }
}

interface GlossaryEditorProps {
  value: GlossaryTerm[];
  onChange: (value: GlossaryTerm[]) => void;
}

export default function GlossaryEditor({ value, onChange }: GlossaryEditorProps) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const headingId = useId();

  // Defer the localStorage read to after mount (SSR has no window) and only
  // start persisting once that initial read has happened, so the persist
  // effect below can't fire first and overwrite a previously saved list
  // with the parent's empty initial state.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadPinnedGlossary();
      if (loaded.length > 0) onChange(loaded);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }, [value, hydrated]);

  const update = (index: number, field: keyof GlossaryTerm, next: string) => {
    onChange(value.map((term, i) => (i === index ? { ...term, [field]: next } : term)));
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const add = () => {
    if (value.length >= MAX_TERMS) return;
    onChange([...value, { english: "", thai: "" }]);
    setOpen(true);
  };

  const pinnedCount = value.filter((t) => t.english.trim() && t.thai.trim()).length;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={headingId}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <h3 className="text-sm font-semibold text-slate-800">Pinned glossary</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {pinnedCount > 0
              ? `${pinnedCount} term${pinnedCount === 1 ? "" : "s"} will be enforced in translation and post-editing.`
              : "Optional — pin required Thai translations for specific terms (e.g. Royal Society terminology)."}
          </p>
        </span>
        <span aria-hidden className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div id={headingId} className="mt-4 space-y-2">
          {value.map((term, index) => (
            <div key={index} className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`glossary-en-${index}`}>English term</label>
              <input
                id={`glossary-en-${index}`}
                value={term.english}
                onChange={(e) => update(index, "english", e.target.value)}
                placeholder="English term"
                className="w-1/2 rounded-lg border border-slate-200 p-2 text-sm"
              />
              <label className="sr-only" htmlFor={`glossary-th-${index}`}>Pinned Thai translation</label>
              <input
                id={`glossary-th-${index}`}
                value={term.thai}
                onChange={(e) => update(index, "thai", e.target.value)}
                placeholder="Pinned Thai translation"
                className="thai-text w-1/2 rounded-lg border border-slate-200 p-2 text-sm"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove term ${term.english || index + 1}`}
                className="shrink-0 rounded-lg px-2 py-2 text-sm text-slate-400 hover:bg-slate-100 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={add}
            disabled={value.length >= MAX_TERMS}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            + Add term
          </button>
        </div>
      )}
    </div>
  );
}
