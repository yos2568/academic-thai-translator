# Academic Thai Translator v2

Next.js app that turns English academic sources into **publishable Thai textbook** material:

1. **Extract** text + figures from `.pdf`, `.docx`, `.txt`, `.png`, `.jpg` (OCR for scans)
2. **Translate** with **Grok OAuth** (SuperGrok / X Premium+) — or an xAI API key
3. **Polish** into formal academic Thai (ภาษาไทยเชิงวิชาการ)
4. **QA** numbers, citations, URLs
5. **Export** textbook-ready `.docx` (TH SarabunPSK, thesis margins, headings, captions, page numbers)

## What’s new in v2

| Area | v1 | v2 |
|---|---|---|
| Default AI | Anthropic / generic BYOK | **Grok OAuth** + academic post-edit |
| Auth | API keys only | Device-code **Sign in with Grok**, API key, optional `~/.grok/auth.json` import |
| Export | Flat paragraphs | Structured textbook layout (title, H1–H3, lists, captions, footer page #) |
| Meta | Filename only | Title / author / subject fields |
| Models | Claude-centric | Default `grok-4.5` |

## Features

- **Grok OAuth** for the whole translate → post-edit pipeline (browser device-code flow)
- Extract text **and images** from PDF/DOCX; re-embed figures in the Thai export
- Optional academic post-editing (on by default when you sign in with Grok)
- Deterministic QA for numbers, citations, and URLs
- Multi-provider fallback still available: xAI API key, Anthropic, OpenAI-compatible, Ollama
- Signature-validated uploads (50 MB cap), OCR ceilings, SSRF guards, rate limits
- No server-side document persistence; OAuth tokens stay in the browser (BYOK)

## Local prerequisites

Node.js 22 is recommended.

macOS:

```bash
brew install tesseract tesseract-lang poppler
```

Debian / Ubuntu:

```bash
sudo apt update
sudo apt install tesseract-ocr tesseract-ocr-tha tesseract-ocr-eng poppler-utils
```

## Local setup

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Click **Settings**
2. **Sign in with Grok** (opens auth.x.ai device login — SuperGrok or X Premium+)
3. Upload a PDF / DOCX / TXT
4. Review text → Translate → Export **textbook .docx**

### Optional: use your existing Grok CLI session

If you already ran `grok login` on this machine:

```bash
# .env.local
ALLOW_GROK_AUTH_IMPORT=true
```

Then in Settings → **Import local Grok CLI**.

### Optional: xAI API key (no OAuth)

```dotenv
XAI_API_KEY=xai-...
XAI_MODEL=grok-4.5
```

Or paste the key under Settings → provider **xAI API key**.

## Environment variables

See [`.env.example`](./.env.example). Highlights:

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | Server-side Grok API key fallback |
| `XAI_MODEL` / `XAI_POSTEDIT_MODEL` | Default models (`grok-4.5`) |
| `XAI_OAUTH_REFRESH_TOKEN` | Server-side OAuth (single-user) |
| `ALLOW_GROK_AUTH_IMPORT` | Read `~/.grok/auth.json` (trusted host only) |
| `ALLOW_PRIVATE_UPSTREAMS` | Allow Ollama / private OpenAI-compatible URLs |
| `ANTHROPIC_API_KEY` | Legacy Claude fallback |

BYOK credentials (including Grok OAuth tokens) are stored in **browser localStorage** and sent only on translation requests. Use HTTPS on any shared deployment.

## Pipeline

```
Browser → Next.js
  upload → validate → parse / OCR → capture images
  chunks → Grok draft → Grok academic post-edit → QA
  structured Thai → textbook DOCX / TXT
```

## Security model

- Upload type/size verified via extension + magic bytes
- Rate limits on extract / translate / auth / engine test routes
- User-configured upstream URLs are SSRF-checked (`ALLOW_PRIVATE_UPSTREAMS` only for trusted local)
- Grok OAuth uses xAI’s public device-code grant (`auth.x.ai`); refresh tokens are never logged
- `ALLOW_GROK_AUTH_IMPORT=true` must not be enabled on multi-tenant public hosts

If OAuth login works but inference returns **HTTP 403**, your SuperGrok tier may not include API access — use `XAI_API_KEY` from [console.x.ai](https://console.x.ai) instead.

## Testing

```bash
npm test
npm run build
# optional end-to-end (stub provider, no real key):
npm run test:smoke
```

## Deployment

See [DEPLOY.md](./DEPLOY.md) for Docker Compose + Caddy.

For Grok on a private VPS, either:

- Users sign in with Grok in the browser (recommended), or
- Set `XAI_API_KEY` / `XAI_OAUTH_REFRESH_TOKEN` in the container env

## Standalone package and MCP

See [PACKAGE.md](./PACKAGE.md).

## Architecture notes (v2)

| Module | Role |
|---|---|
| `src/lib/xai/oauth.ts` | Device code + refresh against auth.x.ai |
| `src/lib/engines/xai.ts` | `xai` + `xai-oauth` engines → `api.x.ai/v1/chat/completions` |
| `src/app/api/auth/xai/*` | Start / poll device login; optional CLI import |
| `src/lib/structure.ts` | Heading / list / caption detection for DOCX |
| `src/lib/exporter.ts` | Thai textbook Word layout |

## License / origin

App that extracts text (and images) from documents and translates them into academic Thai for textbook publishing.
