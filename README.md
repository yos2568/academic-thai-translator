# Academic Thai Translator

A Next.js 16 application for translating English academic documents into formal Thai. It accepts `.docx`, `.pdf`, `.txt`, `.png`, and `.jpg`, supports OCR, configurable translation and post-edit providers, deterministic QA, and `.docx`/`.txt` export.

## Features

- Multi-provider BYOK: Anthropic, OpenAI-compatible APIs, or Ollama
- Optional academic-register post-editing with a separately selected provider
- Browser-streamed progress and deterministic preservation checks for numbers, citations, and URLs
- Signature-validated uploads capped at 50 MB
- Tesseract Thai/English OCR with a 40-page and 120-second process ceiling
- Private-network SSRF protection for user-supplied upstream URLs
- Per-route request throttling, request-body limits, security headers, and URL-redacted errors
- No server-side document or browser-key persistence

## Local prerequisites

Node.js 22 is recommended.

macOS:

```bash
brew install tesseract tesseract-lang poppler
```

Debian or Ubuntu:

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

For a production-like local run:

```bash
npm run build
npm start
```

All environment variables are optional:

```dotenv
# Optional server-side fallback; with neither value the app remains BYOK-only.
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5

# Required for local Ollama or any private-network upstream.
ALLOW_PRIVATE_UPSTREAMS=true
```

BYOK credentials are stored in the user's browser local storage and sent to this application's route handler only for provider tests and translations. They are never written to server disk or echoed by the API. Use BYOK only over HTTPS on a deployment you trust.

By default, OpenAI-compatible and Ollama URLs must resolve exclusively to public IP addresses. `ALLOW_PRIVATE_UPSTREAMS=true` disables this SSRF control for trusted local deployments.

## Security model

- Caddy provides TLS and team-only HTTP basic authentication in the recommended VPS setup.
- Upload type and size are verified using extensions and magic bytes.
- Translation, extraction, and provider-test routes use namespaced, per-IP rate limits backed by `RateLimitStore` (`src/lib/ratelimit.ts`). The default `MemoryRateLimitStore` is process-local. For multi-instance scaling, implement `RateLimitStore` against shared state (e.g. Redis) and call `setRateLimitStore()` once at startup — no route handler needs to change.
- User-configured upstream hostnames are resolved and every returned IP is checked before connecting. Upstream redirects are rejected so a public URL cannot redirect the server to a private target. A residual DNS-rebinding/time-of-check-to-time-of-use risk remains because the subsequent HTTP client performs its own DNS resolution. This is accepted for the intended password-gated team deployment; a public multi-tenant service should pin resolved addresses or use an egress proxy.
- `ALLOW_PRIVATE_UPSTREAMS=true` intentionally permits private, loopback, link-local, and Compose-internal upstreams. Never enable it on an untrusted public deployment.
- Caddy overwrites forwarding headers in the recommended topology, making the first `X-Forwarded-For` address suitable for this deployment's rate-limit key.

## Testing

Unit tests cover the security- and logic-critical pure modules (SSRF host classification, rate limiting, chunking, QA checks, glossary extraction):

```bash
npm test
```

An end-to-end smoke test builds the standalone bundle, boots it, and drives upload → extract → translate (against a local stub provider, no real API key needed) → export over HTTP:

```bash
npm run test:smoke
```

## Benchmarking engines

To compare draft/post-edit provider configurations on the same document (latency and QA pass rate), copy `benchmark-providers.example.json` to `benchmark-providers.json`, fill in real credentials, start the app, then run:

```bash
npm run benchmark
```

Pass a different fixture or providers file as arguments: `node scripts/benchmark-engines.mjs path/to/doc.txt path/to/providers.json`. Set `TRANSLATOR_APP_URL` if the app isn't at `http://127.0.0.1:3000`.

## Deployment

See [DEPLOY.md](./DEPLOY.md) for Docker Compose, Caddy, automatic HTTPS, basic authentication, firewall configuration, and update instructions.

## Standalone package and MCP

See [PACKAGE.md](./PACKAGE.md) to build a movable standalone app folder and expose the translator as an MCP server for Claude Code, Zed/Z code, Hermes Agent, and similar clients.

## Architecture

```text
Browser → Caddy (TLS + basic auth) → Next.js route handlers
  upload → validation → parser/OCR → review
  chunks → draft provider → optional post-editor → deterministic QA
  final Thai → DOCX/TXT export
```
