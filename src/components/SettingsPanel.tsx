"use client";

import { useEffect, useRef, useState } from "react";
import { XAI_DEFAULT_MODEL } from "@/lib/xai/client-constants";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type ClientProvider =
  | { provider: "xai-oauth"; model: string; accessToken?: string; refreshToken: string; expiresAt?: number; baseUrl?: string }
  | { provider: "xai"; apiKey: string; model: string; baseUrl?: string }
  | { provider: "anthropic"; apiKey: string; model: string }
  | { provider: "openai-compatible"; baseUrl: string; apiKey: string; model: string }
  | { provider: "ollama"; baseUrl: string; model: string }
  | {
      provider: "oauth-openai-compatible";
      baseUrl: string;
      model: string;
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
    };

export interface SavedSettings {
  draft: ClientProvider;
  postedit: ClientProvider | null;
}

const STORAGE_KEY = "academic-thai-translator.providers.v2";
const DEFAULT_GROK: ClientProvider = {
  provider: "xai-oauth",
  model: XAI_DEFAULT_MODEL,
  refreshToken: "",
};
// Fast path by default: one strong Grok pass (no second post-edit round trip).
// Enable "Polish" in Settings when you want slower, double-pass quality.
const DEFAULT: SavedSettings = {
  draft: DEFAULT_GROK,
  postedit: null,
};

export function encodeSettings(settings: SavedSettings | null) {
  if (!settings) return null;
  // Only encode if credentials are present
  const draftOk =
    settings.draft.provider === "xai-oauth"
      ? Boolean(settings.draft.refreshToken)
      : settings.draft.provider === "xai"
        ? Boolean(settings.draft.apiKey)
        : settings.draft.provider === "anthropic"
          ? Boolean(settings.draft.apiKey)
          : settings.draft.provider === "ollama"
            ? Boolean(settings.draft.model)
            : settings.draft.provider === "openai-compatible"
              ? Boolean(settings.draft.model && settings.draft.baseUrl)
              : Boolean(settings.draft.clientId && settings.draft.clientSecret);
  if (!draftOk) return null;
  return btoa(unescape(encodeURIComponent(JSON.stringify(settings))));
}

function providerLabel(p: ClientProvider["provider"]) {
  switch (p) {
    case "xai-oauth":
      return "Grok OAuth (SuperGrok / X Premium+)";
    case "xai":
      return "xAI API key";
    case "anthropic":
      return "Anthropic";
    case "openai-compatible":
      return "OpenAI-compatible";
    case "ollama":
      return "Ollama (local)";
    case "oauth-openai-compatible":
      return "OAuth (client credentials)";
  }
}

function blankProvider(kind: ClientProvider["provider"]): ClientProvider {
  switch (kind) {
    case "xai-oauth":
      return { provider: "xai-oauth", model: XAI_DEFAULT_MODEL, refreshToken: "" };
    case "xai":
      return { provider: "xai", apiKey: "", model: XAI_DEFAULT_MODEL };
    case "anthropic":
      return { provider: "anthropic", apiKey: "", model: "claude-sonnet-4-5" };
    case "ollama":
      return { provider: "ollama", baseUrl: "http://localhost:11434", model: "typhoon-translate:4b" };
    case "oauth-openai-compatible":
      return { provider: "oauth-openai-compatible", baseUrl: "", model: "", tokenUrl: "", clientId: "", clientSecret: "" };
    default:
      return { provider: "openai-compatible", baseUrl: "https://api.opentyphoon.ai/v1", apiKey: "", model: "typhoon-v2.1-12b-instruct" };
  }
}

export default function SettingsPanel({
  value,
  onChange,
}: {
  value: SavedSettings | null;
  onChange: (value: SavedSettings | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ClientProvider>(DEFAULT.draft);
  const [postEditEnabled, setPostEditEnabled] = useState(false);
  const [postedit, setPostedit] = useState<ClientProvider>({
    provider: "xai-oauth",
    model: XAI_DEFAULT_MODEL,
    refreshToken: "",
  });
  const [status, setStatus] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthHint, setOauthHint] = useState<{ userCode: string; uri: string } | null>(null);
  const [importAvailable, setImportAvailable] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pollAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      (previouslyFocused ?? triggerRef.current)?.focus();
    };
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("academic-thai-translator.providers.v1");
        if (saved) {
          const parsed = JSON.parse(saved) as SavedSettings;
          setDraft(parsed.draft);
          setPostEditEnabled(Boolean(parsed.postedit));
          if (parsed.postedit) setPostedit(parsed.postedit);
          onChange(parsed);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onChange]);

  useEffect(() => {
    fetch("/api/engines")
      .then((r) => r.json())
      .then((data) => setImportAvailable(Boolean(data.grokAuthImport)))
      .catch(() => setImportAvailable(false));
  }, []);

  useEffect(() => {
    return () => pollAbort.current?.abort();
  }, []);

  const applyOauthProvider = (provider: ClientProvider) => {
    // Fast default: single Grok pass. User can enable polish for a 2nd pass.
    const saved: SavedSettings = {
      draft: provider,
      postedit: postEditEnabled ? { ...provider } : null,
    };
    setDraft(provider);
    setPostedit(provider);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    onChange(saved);
  };

  const signInWithGrok = async () => {
    setOauthBusy(true);
    setStatus("Starting Grok sign-in…");
    setOauthHint(null);
    pollAbort.current?.abort();
    const controller = new AbortController();
    pollAbort.current = controller;
    try {
      const startRes = await fetch("/api/auth/xai/device", { method: "POST", signal: controller.signal });
      const start = await startRes.json();
      if (!startRes.ok) throw new Error(start.error || "Could not start Grok sign-in.");

      const uri = start.verificationUriComplete || start.verificationUri;
      setOauthHint({ userCode: start.userCode, uri: start.verificationUri });
      setStatus(`Open the sign-in page and enter code ${start.userCode}`);
      window.open(uri, "_blank", "noopener,noreferrer");

      const deadline = Date.now() + (Number(start.expiresIn) || 900) * 1000;
      let intervalMs = Math.max(3, Number(start.interval) || 5) * 1000;

      while (Date.now() < deadline) {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        await new Promise((r) => setTimeout(r, intervalMs));
        const pollRes = await fetch("/api/auth/xai/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode: start.deviceCode }),
          signal: controller.signal,
        });
        const poll = await pollRes.json();
        if (poll.status === "ready" && poll.provider) {
          applyOauthProvider(poll.provider as ClientProvider);
          setOauthHint(null);
          setStatus("Signed in with Grok ✓ — draft + academic polish both use Grok.");
          return;
        }
        if (poll.status === "slow_down" && poll.interval) {
          intervalMs = Math.max(intervalMs, Number(poll.interval) * 1000);
          continue;
        }
        if (poll.status === "pending") continue;
        throw new Error(poll.error || "Grok sign-in failed.");
      }
      throw new Error("Sign-in timed out. Try again.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus(err instanceof Error ? err.message : "Grok sign-in failed.");
    } finally {
      setOauthBusy(false);
    }
  };

  const importLocalGrok = async () => {
    setStatus("Importing local Grok CLI session…");
    try {
      const res = await fetch("/api/auth/xai/import", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed.");
      applyOauthProvider(data.provider as ClientProvider);
      setStatus("Imported Grok CLI session ✓");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed.");
    }
  };

  const save = () => {
    const next = { draft, postedit: postEditEnabled ? postedit : null };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    onChange(next);
    setOpen(false);
    setStatus("");
  };

  const clear = () => {
    pollAbort.current?.abort();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("academic-thai-translator.providers.v1");
    onChange(null);
    setDraft(DEFAULT.draft);
    setPostedit({ provider: "xai-oauth", model: XAI_DEFAULT_MODEL, refreshToken: "" });
    setPostEditEnabled(false);
    setOpen(false);
    setOauthHint(null);
    setStatus("");
  };

  const test = async (provider: ClientProvider) => {
    setStatus("Testing…");
    const res = await fetch("/api/engines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(provider),
    });
    const data = await res.json().catch(() => ({}));
    setStatus(data.ok ? "Connection successful ✓" : data.error || "Connection failed.");
  };

  const grokSignedIn =
    draft.provider === "xai-oauth" && Boolean(draft.refreshToken);

  const form = (provider: ClientProvider, setProvider: (provider: ClientProvider) => void) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-medium text-slate-600">
        Provider
        <select
          value={provider.provider}
          onChange={(e) => setProvider(blankProvider(e.target.value as ClientProvider["provider"]))}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm"
        >
          <option value="xai-oauth">{providerLabel("xai-oauth")}</option>
          <option value="xai">{providerLabel("xai")}</option>
          <option value="anthropic">{providerLabel("anthropic")}</option>
          <option value="openai-compatible">{providerLabel("openai-compatible")}</option>
          <option value="ollama">{providerLabel("ollama")}</option>
          <option value="oauth-openai-compatible">{providerLabel("oauth-openai-compatible")}</option>
        </select>
      </label>
      <label className="text-xs font-medium text-slate-600">
        Model
        <input
          value={provider.model}
          onChange={(e) => setProvider({ ...provider, model: e.target.value } as ClientProvider)}
          className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
          placeholder={XAI_DEFAULT_MODEL}
        />
      </label>

      {provider.provider === "xai-oauth" && (
        <div className="sm:col-span-2 space-y-3 rounded-xl border border-violet-100 bg-violet-50/60 p-4">
          <p className="text-sm text-slate-700">
            Sign in with your <strong>SuperGrok</strong> or <strong>X Premium+</strong> account. Tokens stay in this
            browser and are sent only with translation requests.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={oauthBusy}
              onClick={signInWithGrok}
              className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
            >
              {oauthBusy ? "Waiting for approval…" : grokSignedIn ? "Re-sign in with Grok" : "Sign in with Grok"}
            </button>
            {importAvailable && (
              <button
                type="button"
                onClick={importLocalGrok}
                className="rounded-lg border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-50"
              >
                Import local Grok CLI
              </button>
            )}
          </div>
          {oauthHint && (
            <p className="text-sm text-violet-900">
              Code: <span className="font-mono font-bold tracking-wider">{oauthHint.userCode}</span>
              {" · "}
              <a href={oauthHint.uri} target="_blank" rel="noreferrer" className="underline">
                {oauthHint.uri}
              </a>
            </p>
          )}
          {grokSignedIn && (
            <p className="text-xs font-medium text-emerald-700">Grok OAuth session saved in this browser.</p>
          )}
        </div>
      )}

      {provider.provider === "xai" && (
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">
          xAI API key
          <input
            type="password"
            autoComplete="off"
            value={provider.apiKey}
            onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })}
            placeholder="xai-… from console.x.ai"
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
          />
        </label>
      )}

      {provider.provider !== "anthropic" &&
        provider.provider !== "xai" &&
        provider.provider !== "xai-oauth" && (
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            Base URL
            <input
              value={"baseUrl" in provider ? provider.baseUrl : ""}
              onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value } as ClientProvider)}
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
            />
          </label>
        )}

      {(provider.provider === "anthropic" || provider.provider === "openai-compatible") && (
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">
          API key
          <input
            type="password"
            autoComplete="off"
            value={provider.apiKey}
            onChange={(e) => setProvider({ ...provider, apiKey: e.target.value } as ClientProvider)}
            placeholder="Stored only in this browser"
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
          />
        </label>
      )}

      {provider.provider === "oauth-openai-compatible" && (
        <>
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            Token URL
            <input
              value={provider.tokenUrl}
              onChange={(e) => setProvider({ ...provider, tokenUrl: e.target.value })}
              placeholder="https://auth.example.com/oauth/token"
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Client ID
            <input
              value={provider.clientId}
              onChange={(e) => setProvider({ ...provider, clientId: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Client secret
            <input
              type="password"
              autoComplete="off"
              value={provider.clientSecret}
              onChange={(e) => setProvider({ ...provider, clientSecret: e.target.value })}
              placeholder="Stored only in this browser"
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
            />
          </label>
        </>
      )}

      <button
        type="button"
        onClick={() => test(provider)}
        className="justify-self-start rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
      >
        Test connection
      </button>
    </div>
  );

  const signedInBadge =
    value?.draft.provider === "xai-oauth" && "refreshToken" in value.draft && value.draft.refreshToken
      ? " · Grok"
      : value
        ? " · BYOK"
        : "";

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
      >
        ⚙ Settings{signedInBadge}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-panel-title"
        >
          <div ref={dialogRef} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 id="settings-panel-title" className="text-lg font-bold text-slate-900">
                  Translation settings
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  v2 uses Grok OAuth. Fast mode = one pass; optional polish doubles time for a second edit.
                </p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <section className="mt-6">
              <h3 className="mb-3 text-sm font-semibold">Draft translation</h3>
              {form(draft, setDraft)}
            </section>
            <section className="mt-6 border-t border-slate-100 pt-5">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={postEditEnabled}
                  onChange={(e) => setPostEditEnabled(e.target.checked)}
                />
                Extra polish pass (slower — ~2× time; use for final publish)
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Leave off for speed. The main Grok pass already targets formal academic Thai.
              </p>
              {postEditEnabled && <div className="mt-4">{form(postedit, setPostedit)}</div>}
            </section>
            {status && <p className="mt-4 text-sm text-blue-700">{status}</p>}
            <div className="mt-6 flex justify-between border-t border-slate-100 pt-5">
              <button onClick={clear} className="text-sm font-medium text-red-600">
                Clear keys / sign out
              </button>
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm">
                  Cancel
                </button>
                <button onClick={save} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white">
                  Save settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
