"use client";

import { useCallback, useRef, useState } from "react";
import StepIndicator from "@/components/StepIndicator";
import UploadCard from "@/components/UploadCard";
import TextPreview from "@/components/TextPreview";
import TranslationPanel from "@/components/TranslationPanel";
import ExportBar from "@/components/ExportBar";
import SettingsPanel, { encodeSettings, type SavedSettings } from "@/components/SettingsPanel";
import QaReportCard from "@/components/QaReportCard";
import type { QaReport } from "@/lib/qa/checks";
import type { CapturedDocumentImage } from "@/lib/document-images";

type Step = "upload" | "review" | "translating" | "done";

const STEP_INDEX: Record<Step, number> = {
  upload: 0,
  review: 1,
  translating: 2,
  done: 3,
};

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [thaiText, setThaiText] = useState("");
  const [capturedImages, setCapturedImages] = useState<CapturedDocumentImage[]>([]);
  const [imageWarning, setImageWarning] = useState<string | undefined>();
  const [progress, setProgress] = useState<{ chunk: number; total: number } | null>(null);
  const [stage, setStage] = useState<"draft" | "postedit" | "qa">("draft");
  const [settings, setSettings] = useState<SavedSettings | null>(null);
  const [qaReports, setQaReports] = useState<QaReport[]>([]);
  const [usedOcr, setUsedOcr] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState({
    percent: 0,
    message: "Waiting to start…",
  });
  const abortRef = useRef<AbortController | null>(null);
  const chunkTextRef = useRef<Record<number, string>>({});

  const syncOutput = () => setThaiText(Object.keys(chunkTextRef.current).map(Number).sort((a, b) => a - b).map((key) => chunkTextRef.current[key]).join(""));

  const reset = () => {
    abortRef.current?.abort();
    setStep("upload");
    setError(null);
    setFilename("");
    setSourceText("");
    setThaiText("");
    setCapturedImages([]);
    setImageWarning(undefined);
    setProgress(null);
    setQaReports([]);
    setUsedOcr(false);
    setBusy(false);
    setExtractionProgress({ percent: 0, message: "Waiting to start…" });
    chunkTextRef.current = {};
  };

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setExtractionProgress({ percent: 1, message: "Starting upload…" });
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 195_000);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body: formData,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Could not read the file.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: {
        text: string;
        images?: CapturedDocumentImage[];
        meta: { filename: string; ocr: boolean; imageWarning?: string };
      } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "progress") {
            setExtractionProgress({
              percent: Math.max(1, Math.min(100, Number(event.percent))),
              message: String(event.message),
            });
          } else if (event.type === "result") {
            result = event.data;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }

      if (!result) throw new Error("Document processing ended unexpectedly.");
      setFilename(result.meta.filename);
      setSourceText(result.text);
      setCapturedImages(result.images ?? []);
      setImageWarning(result.meta.imageWarning);
      setUsedOcr(Boolean(result.meta.ocr));
      setStep("review");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(
          timedOut
            ? "Document reading timed out. Split a scanned PDF into smaller sections and try again."
            : "Document reading was cancelled."
        );
        return;
      }
      setError(err instanceof Error ? err.message : "Could not read the file.");
    } finally {
      window.clearTimeout(timer);
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }, []);

  const translate = useCallback(async () => {
    setStep("translating");
    setError(null);
    setThaiText("");
    setProgress(null);
    setQaReports([]);
    chunkTextRef.current = {};

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(encodeSettings(settings) ? { "X-Provider-Config": encodeSettings(settings)! } : {}),
        },
        body: JSON.stringify({ text: sourceText }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Translation failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "delta") {
            const key = Number(event.chunk || 1);
            chunkTextRef.current[key] = (chunkTextRef.current[key] || "") + event.text;
            syncOutput();
          } else if (event.type === "replace_chunk") {
            const key = Number(event.chunk);
            const prefix = chunkTextRef.current[key]?.startsWith("\n\n") ? "\n\n" : "";
            chunkTextRef.current[key] = prefix + event.text;
            syncOutput();
          } else if (event.type === "progress") {
            setProgress({ chunk: event.chunk, total: event.total });
          } else if (event.type === "stage") {
            setStage(event.stage);
          } else if (event.type === "qa") {
            setQaReports((prev) => [...prev, event.report]);
          } else if (event.type === "error") {
            throw new Error(event.message);
          } else if (event.type === "done") {
            finished = true;
          }
        }
      }

      if (!finished) {
        throw new Error("The translation stream ended unexpectedly.");
      }
      setStep("done");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Translation failed.");
      setStep("review");
    } finally {
      abortRef.current = null;
    }
  }, [sourceText, settings]);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-10 text-center">
        <div className="mb-5 flex justify-end"><SettingsPanel value={settings} onChange={setSettings} /></div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Academic Thai Translator
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500 sm:text-base">
          Convert English documents into formal, academic Thai — with
          consistent terminology and clean document export.
        </p>
      </header>

      <div className="mb-8">
        <StepIndicator current={STEP_INDEX[step]} />
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="font-semibold text-red-400 hover:text-red-600"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      <main className="space-y-6">
        {step === "upload" && (
          <UploadCard
            onFile={handleFile}
            onError={setError}
            busy={busy}
            onCancel={() => abortRef.current?.abort()}
            progress={extractionProgress}
          />
        )}

        {step === "review" && (
            <TextPreview
            text={sourceText}
            filename={filename}
            images={capturedImages}
            imageWarning={imageWarning}
            onChange={setSourceText}
            onTranslate={translate}
              onBack={reset}
              usedOcr={usedOcr}
          />
        )}

        {(step === "translating" || step === "done") && (
          <>
            {step === "done" && (
              <><QaReportCard reports={qaReports} /><ExportBar
                thaiText={thaiText}
                filename={filename}
                images={capturedImages}
                onRestart={reset}
                onError={setError}
              /></>
            )}
            <TranslationPanel
              sourceText={sourceText}
              thaiText={thaiText}
              translating={step === "translating"}
              progress={progress}
              stage={stage}
            />
          </>
        )}
      </main>

      <footer className="mt-12 text-center text-xs text-slate-500">
        Files are processed in memory and never stored on the server.
      </footer>
    </div>
  );
}
