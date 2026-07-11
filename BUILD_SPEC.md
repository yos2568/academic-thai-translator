# Multi-Engine Translation Pipeline — Source Selection & App Skeleton (Plan Only)

## Context

The Academic Thai Translator (built in `academic-thai-translator/`, working and verified) currently uses a single engine: Claude translates extracted text in one pass. The user shared a survey of Thai OCR tools, translation-first models (NLLB, Typhoon Translate), and Thai LLMs (Typhoon 2, KhanomTanLLM, OpenThaiGPT) and asked **which sources to select for the most accurate results**, plus the **skeleton/structure** of the upgraded app. This plan selects a stack, explains why, and lays out the architecture. No code changes yet.

---

## 1. Source selection — what I'd pick and why

Principle from the user's own research (correct): **a dedicated translation model produces the faithful draft; a Thai-capable LLM handles register, terminology, and QA.** Don't ask one model to do everything.

### Selected stack (per stage)

| Stage | Primary pick | Fallback / alternative | Why |
|---|---|---|---|
| **OCR** (scanned PDFs, images) | **Tesseract + `tha.traineddata`** (local, free) | Google Cloud Vision (flag-gated, for messy scans) | Academic papers are mostly clean printed text — Tesseract's weak spot (photos, complex layouts) rarely applies. Local = no GCP account, no document leaves the machine. Vision API behind an env flag for users who need it. |
| **OCR normalization** | **PyThaiNLP** (via a small Python sidecar) — only if OCR'ing Thai source text | — | Fixes Thai-specific OCR artifacts (broken sara/tone marks, spacing). For EN→TH the source is English, so this is only needed if the app later ingests Thai scans. |
| **Draft translation** | **Typhoon Translate 1.5 4B** via Ollama (local) | NLLB-200 600M/3.3B (CTranslate2) as batch/offline fallback; Claude direct as the zero-setup default | Typhoon Translate is Thai-specialized and produces more natural Thai than stock NLLB; 4B runs on consumer hardware. NLLB is the safer pure-fidelity baseline — keep both behind one interface and benchmark on the user's real documents. |
| **Post-edit (academic register)** | **Claude (already integrated)** with a strict post-edit prompt | Typhoon 2 (local, via Ollama) for a fully-local mode | Claude is the strongest available editor for formal ภาษาไทยเชิงวิชาการ, glossary enforcement, and "preserve numbers/citations verbatim" instructions — and it's already wired in. Typhoon 2 is the local swap-in. |
| **QA / verification** | **Deterministic code checks** (not an LLM): numbers, dates, citations, URLs, parenthesized English terms diffed source↔target | Claude flag-check pass for unresolved mismatches | Cheap, exact, and catches the highest-impact errors (a dropped "87.4%" is worse than an awkward sentence). LLM QA only for what code can't check. |

**What to avoid** (agreeing with the user's notes): narrow fine-tunes (e.g. Bible-trained NLLB) for general academic text; PaddleOCR for Thai (needs custom training); using a chat LLM alone for the faithful draft on long documents.

### Why this beats the current single-pass design

- **Fidelity + fluency separated:** the translation model won't paraphrase or drop content; the post-editor won't hallucinate because it's instructed to preserve the draft's meaning.
- **Degradable:** every stage has a "Claude does it" fallback, so the app still works with zero local models installed (current behavior becomes `engine=claude-direct`).
- **Benchmarkable:** one `TranslationEngine` interface means engines can be A/B compared on the same document.

---

## 2. App skeleton (target structure)

```
academic-thai-translator/
├── .env.local                        # ANTHROPIC_API_KEY, OLLAMA_URL, GOOGLE_VISION_KEY (optional)
├── config/
│   └── pipeline.ts                   # engine selection defaults, feature flags per stage
├── src/
│   ├── app/
│   │   ├── page.tsx                  # workflow UI (adds engine picker + QA report step)
│   │   └── api/
│   │       ├── extract/route.ts      # EXISTS — gains OCR branch for scanned PDFs/images
│   │       ├── translate/route.ts    # EXISTS — becomes pipeline orchestrator (SSE per stage)
│   │       ├── export/route.ts       # EXISTS — unchanged
│   │       └── engines/route.ts      # NEW — reports which engines are available (Ollama up? key set?)
│   ├── lib/
│   │   ├── validation.ts             # EXISTS — add image MIME/magic-byte support (.png/.jpg)
│   │   ├── parsers.ts                # EXISTS — detect "no text layer" PDFs → route to OCR
│   │   ├── chunker.ts                # EXISTS — reused unchanged
│   │   ├── exporter.ts               # EXISTS — unchanged
│   │   ├── ocr/
│   │   │   ├── index.ts              # OcrEngine interface: (image|pdf) → text + confidence
│   │   │   ├── tesseract.ts          # node-tesseract-ocr / tesseract.js, tha+eng
│   │   │   └── google-vision.ts      # flag-gated alternative
│   │   ├── engines/
│   │   │   ├── index.ts              # TranslationEngine interface + registry/selection logic
│   │   │   ├── claude-direct.ts      # current behavior (translator.ts refactored in)
│   │   │   ├── ollama.ts             # GENERIC Ollama adapter: any model tag from config
│   │   │   │                         #   (typhoon-translate, hermes3, qwen3, typhoon2, …)
│   │   │   └── nllb.ts               # CTranslate2 via Python sidecar or HTTP microservice
│   │   ├── postedit/
│   │   │   ├── claude.ts             # academic-register rewrite prompt (glossary-aware)
│   │   │   └── typhoon2.ts           # local alternative via Ollama
│   │   ├── qa/
│   │   │   ├── checks.ts             # numbers/dates/citations/URLs/term-parens diff
│   │   │   └── report.ts             # QaReport type: pass/warn per check, per chunk
│   │   └── glossary.ts               # rolling EN→TH glossary (extracted from translator.ts)
│   └── components/
│       ├── ...existing components
│       ├── EnginePicker.tsx          # NEW — choose draft engine + post-edit on/off
│       ├── OcrReview.tsx             # NEW — editable OCR text with low-confidence highlights
│       └── QaReportCard.tsx          # NEW — verification results before export
└── sidecar/                          # OPTIONAL, only for NLLB/PyThaiNLP stages
    └── serve.py                      # FastAPI: /ocr-normalize (PyThaiNLP), /translate (CTranslate2)
```

### Pipeline data flow

```
upload ─▶ extract ──(has text layer?)──▶ text ─▶ chunk
              └─ no ─▶ OCR (tesseract tha+eng) ─▶ OcrReview UI ─┘
chunk[i] ─▶ TranslationEngine.translate()      (typhoon-translate | nllb | claude-direct)
        ─▶ PostEditor.rewrite(draft, glossary) (claude | typhoon2 | off)
        ─▶ qa/checks.ts (deterministic diff)
        ─▶ SSE: {stage, chunk, delta | qa-flags}  ─▶ UI streams draft → final + QA card
─▶ export (.docx/.txt, unchanged)
```

Key contracts:
- `TranslationEngine`: `{ id, available(): Promise<boolean>, translate(chunk, opts, onDelta): Promise<string> }` — `claude-direct` implements it first so the refactor lands with zero behavior change.
- Post-edit prompt (from the user's template, hardened): preserve meaning exactly; keep numbers, dates, currencies, URLs, citations, code, and English technical terms; formal academic register; output Thai only.
- QA checks run per chunk and never block export — they annotate.

---

## 3. Implementation steps (when approved)

1. **Refactor to engine interface** — extract current Claude logic from `src/lib/translator.ts` into `engines/claude-direct.ts` + `glossary.ts`; add registry + `/api/engines`. App behaves identically after this step.
2. **Pipeline orchestrator** — rework `/api/translate` to run draft → post-edit → QA per chunk, extending the existing SSE event vocabulary with `stage` and `qa` events; UI shows stage progress.
3. **QA module** — deterministic checks first (`qa/checks.ts`), `QaReportCard` in UI before the Export step.
4. **Generic Ollama engine** — one adapter (`OLLAMA_URL`, default `http://localhost:11434`) parameterized by model tag, so Typhoon Translate, Hermes, Qwen, etc. are config entries, not code. Engine picker shows each configured model only when `available()`. This also enables a fully-offline mode (Ollama draft + Ollama post-edit, no Claude key needed).
5. **Post-edit stage** — Claude post-editor with the strict rewrite prompt; toggle in `EnginePicker`; any Ollama model (Typhoon 2, Hermes 3, …) usable as the post-editor via the same generic adapter. Expect Claude to outperform 4–8B local models on formal academic register — keep both selectable and compare on real documents.
6. **OCR stage** — accept `.png/.jpg` + detect textless PDFs in `parsers.ts`; Tesseract with `tha+eng`; `OcrReview` step inserted before Review. Google Vision adapter flag-gated.
7. **(Optional) NLLB sidecar** — FastAPI + CTranslate2 for batch NLLB drafts; only if benchmarking shows Typhoon Translate falls short on fidelity.

Steps 1–3 deliver most of the accuracy win (post-edit + QA) with no new infrastructure; 4–7 add the local/multi-engine options incrementally.

## 4. Verification

- After step 1: existing curl tests against `/api/extract`, `/api/translate` (SSE), `/api/export` behave identically; `npx tsc --noEmit` clean.
- After step 3: translate a fixture containing numbers, a citation "(Smith, 2020)", and a URL — QA card must show all preserved; mutate a draft in a unit test to confirm checks catch a dropped number.
- After step 4: with Ollama running `typhoon-translate`, pick it in EnginePicker and confirm draft streams from the local model (server logs), then Claude post-edit output replaces it.
- After step 6: upload a scanned (image-only) PDF fixture → OCR review appears with extracted text; a clean digital PDF must *not* trigger OCR.
- Full flow via browser preview: upload → (OCR review) → review → translate with stage progress → QA card → export .docx, reopened to confirm Thai content.

---

## 5. Addendum: Bring-Your-Own-API (BYOK)

### Goal

The app ships with **no baked-in credentials**. Each user supplies their own provider at runtime — an Anthropic key, any OpenAI-compatible endpoint (Typhoon API, OpenRouter, Together, LM Studio, vLLM), or a local Ollama URL — through a Settings panel. Server env vars become an optional fallback for self-hosted deployments, not a requirement.

### Provider model

The user assigns a provider+model to each pipeline stage independently (draft / post-edit), e.g. draft = Ollama `typhoon-translate:4b`, post-edit = their own Anthropic key.

| Provider type | Config fields | Covers |
|---|---|---|
| `anthropic` | `apiKey` | Claude (best post-edit quality) |
| `openai-compatible` | `baseUrl`, `apiKey`, `model` | Typhoon API (opentyphoon.ai), OpenRouter, Together, LM Studio, vLLM, Ollama's `/v1` endpoint — one adapter, many vendors |
| `ollama` | `baseUrl`, `model` | Local models, no key needed |

### Key handling rules

- **Keys never touch the server's disk or env.** The browser stores settings in `localStorage` and sends them **per request** in a header to the app's own API routes:
  `X-Provider-Config: base64(JSON{ draft: {...}, postedit: {...} })`. The route handler uses them for the upstream call and discards them; nothing persisted, nothing logged (redact the header in any request logging).
- **Always proxy through the app's API routes** — never call Anthropic/OpenAI directly from the browser (key exposure to page scripts; CORS blocks most providers anyway). The `/api/translate` SSE route is already that proxy; it reads per-request config instead of `process.env` only.
- **Resolution order** in `getProviderConfig(request)`: per-request header (user's key) → server env vars → engine reported unavailable.
- **Never echo keys back.** `/api/engines` (POST) validates a submitted config with one cheap upstream ping and returns only `{provider, ok, models?}` — never the key.
- UI: password-type inputs, masked display (`sk-ant-…3kF9`), "Test connection" per provider, "Clear keys" action, and a note that keys are stored in the browser only.

### Code changes to the base spec

- `TranslationEngine.translate(...)` / `PostEditor.rewrite(...)` gain a `config: ProviderConfig` parameter; provider clients are instantiated per request, not as module singletons (the base app already isolates this in `getClient()` in `src/lib/translator.ts`).
- New `src/lib/providers.ts` — `ProviderConfig` type, header parse + zod validation, env fallback, redaction helper.
- New `src/components/SettingsPanel.tsx` — provider forms per stage, test-connection, localStorage persistence.
- `/api/engines` gains `POST` (test a submitted config) alongside `GET` (env-based availability).
- Rate limiting stays per-IP regardless of whose key is used.

### Trust caveat

Header pass-through BYOK is appropriate when the user trusts the deployment (their own machine or team server) — the server sees the key in memory during each request. If the app is ever offered as a public multi-tenant service, replace it with authenticated, per-user encrypted key storage; do not keep the header pattern silently.

### BYOK verification

- Configure a key only in the browser (server env empty) → translation works; restart server → key survives in browser, server still has none.
- Submit an invalid key to `/api/engines` POST → `{ok: false}` and the response contains no key material.
- Grep server logs and client bundle for the key after a full run → no matches.
- Env-only mode (no browser config, key in `.env.local`) → app behaves exactly as the base spec.
