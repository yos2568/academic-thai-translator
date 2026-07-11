"use client";

import { useEffect, useState } from "react";

export type ClientProvider =
  | { provider: "anthropic"; apiKey: string; model: string }
  | { provider: "openai-compatible"; baseUrl: string; apiKey: string; model: string }
  | { provider: "ollama"; baseUrl: string; model: string };
export interface SavedSettings { draft: ClientProvider; postedit: ClientProvider | null }

const STORAGE_KEY = "academic-thai-translator.providers.v1";
const DEFAULT: SavedSettings = { draft: { provider: "anthropic", apiKey: "", model: "claude-sonnet-4-5" }, postedit: null };

export function encodeSettings(settings: SavedSettings | null) {
  if (!settings) return null;
  return btoa(unescape(encodeURIComponent(JSON.stringify(settings))));
}

export default function SettingsPanel({ value, onChange }: { value: SavedSettings | null; onChange: (value: SavedSettings | null) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ClientProvider>(DEFAULT.draft);
  const [postEditEnabled, setPostEditEnabled] = useState(false);
  const [postedit, setPostedit] = useState<ClientProvider>({ provider: "anthropic", apiKey: "", model: "claude-sonnet-4-5" });
  const [status, setStatus] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as SavedSettings;
          setDraft(parsed.draft); setPostEditEnabled(Boolean(parsed.postedit));
          if (parsed.postedit) setPostedit(parsed.postedit);
          onChange(parsed);
        }
      } catch { localStorage.removeItem(STORAGE_KEY); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onChange]);

  const save = () => {
    const next = { draft, postedit: postEditEnabled ? postedit : null };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    onChange(next); setOpen(false); setStatus("");
  };
  const clear = () => { localStorage.removeItem(STORAGE_KEY); onChange(null); setDraft(DEFAULT.draft); setPostEditEnabled(false); setOpen(false); };
  const test = async (provider: ClientProvider) => {
    setStatus("Testing…");
    const res = await fetch("/api/engines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(provider) });
    const data = await res.json().catch(() => ({}));
    setStatus(data.ok ? "Connection successful ✓" : data.error || "Connection failed.");
  };

  const form = (provider: ClientProvider, setProvider: (provider: ClientProvider) => void) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-medium text-slate-600">Provider
        <select value={provider.provider} onChange={(e) => {
          const kind = e.target.value;
          setProvider(kind === "anthropic" ? { provider: "anthropic", apiKey: "", model: "claude-sonnet-4-5" } : kind === "ollama" ? { provider: "ollama", baseUrl: "http://localhost:11434", model: "typhoon-translate:4b" } : { provider: "openai-compatible", baseUrl: "https://api.opentyphoon.ai/v1", apiKey: "", model: "typhoon-v2.1-12b-instruct" });
        }} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm">
          <option value="anthropic">Anthropic</option><option value="openai-compatible">OpenAI-compatible</option><option value="ollama">Ollama (local)</option>
        </select>
      </label>
      <label className="text-xs font-medium text-slate-600">Model
        <input value={provider.model} onChange={(e) => setProvider({ ...provider, model: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" />
      </label>
      {provider.provider !== "anthropic" && <label className="text-xs font-medium text-slate-600 sm:col-span-2">Base URL
        <input value={provider.baseUrl} onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" />
      </label>}
      {provider.provider !== "ollama" && <label className="text-xs font-medium text-slate-600 sm:col-span-2">API key
        <input type="password" autoComplete="off" value={provider.apiKey} onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })} placeholder="Stored only in this browser" className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" />
      </label>}
      <button type="button" onClick={() => test(provider)} className="justify-self-start rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Test connection</button>
    </div>
  );

  return <>
    <button onClick={() => setOpen(true)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50">⚙ Settings{value ? " · BYOK" : ""}</button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between"><div><h2 className="text-lg font-bold text-slate-900">Translation settings</h2><p className="mt-1 text-sm text-slate-500">Keys stay in this browser and are sent only with translation requests.</p></div><button onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
        <section className="mt-6"><h3 className="mb-3 text-sm font-semibold">Draft translation</h3>{form(draft, setDraft)}</section>
        <section className="mt-6 border-t border-slate-100 pt-5"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={postEditEnabled} onChange={(e) => setPostEditEnabled(e.target.checked)} /> Polish into academic Thai</label>{postEditEnabled && <div className="mt-4">{form(postedit, setPostedit)}</div>}</section>
        {status && <p className="mt-4 text-sm text-blue-700">{status}</p>}
        <div className="mt-6 flex justify-between border-t border-slate-100 pt-5"><button onClick={clear} className="text-sm font-medium text-red-600">Clear keys</button><div className="flex gap-2"><button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm">Cancel</button><button onClick={save} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white">Save settings</button></div></div>
      </div>
    </div>}
  </>;
}
