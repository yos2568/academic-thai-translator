# Packaging And MCP

This app can be used in three ways:

1. The normal browser app at `http://localhost:3000`
2. A standalone folder generated from the Next.js production build
3. An MCP server that lets Claude Code, Zed/Z code, Hermes Agent, and similar tools call the translator workflow

## Standalone App

Build and package:

```bash
npm run package:standalone
```

The bundle is created at:

```text
dist/academic-thai-translator
```

Move that folder anywhere with Node.js 22 installed, then run:

```bash
npm install --omit=dev
npm start
```

Open:

```text
http://localhost:3000
```

For OCR and PDF figure extraction, the machine still needs:

- Tesseract with `eng` and `tha`
- Poppler utilities

On macOS:

```bash
brew install tesseract tesseract-lang poppler
```

## OpenRouter Setup

For browser use, open Settings and choose:

```text
Provider: OpenAI-compatible
Base URL: https://openrouter.ai/api/v1
API key: your OpenRouter key
Model: the OpenRouter model you want
```

For server-side fallback, set:

```dotenv
LOCAL_OPENAI_BASE_URL=https://openrouter.ai/api/v1
LOCAL_OPENAI_API_KEY=your-openrouter-key
LOCAL_OPENAI_MODEL=openrouter-model-name
```

## MCP Server

The MCP server is a bridge to the running app. Start the app first:

```bash
npm run dev
```

Then configure your MCP client to run:

```bash
node /absolute/path/to/scripts/mcp-server.mjs
```

Useful environment variables:

```dotenv
TRANSLATOR_APP_URL=http://127.0.0.1:3000
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=openrouter-model-name
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Available MCP tools:

- `translator_health`
- `extract_document`
- `translate_text_to_thai`
- `translate_file_to_thai`

The full-file tool extracts text, preserves captured figures for `.docx`, translates into Thai, and writes a `.docx` or `.txt` output file.

## Example MCP Config

```json
{
  "mcpServers": {
    "academic-thai-translator": {
      "command": "node",
      "args": ["/absolute/path/to/scripts/mcp-server.mjs"],
      "env": {
        "TRANSLATOR_APP_URL": "http://127.0.0.1:3000",
        "OPENROUTER_API_KEY": "your-openrouter-key",
        "OPENROUTER_MODEL": "openrouter-model-name"
      }
    }
  }
}
```

