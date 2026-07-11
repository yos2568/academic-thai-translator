#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const APP_URL = (process.env.TRANSLATOR_APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

const ProviderSchema = z.object({
  provider: z.enum(["anthropic", "openai-compatible", "ollama"]),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

const PipelineSchema = z.object({
  draft: ProviderSchema,
  postedit: ProviderSchema.nullable().optional(),
});

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function withoutImageData(image) {
  const copy = { ...image };
  delete copy.data;
  return copy;
}

function providerHeader(provider) {
  const config = provider ?? envProvider();
  if (!config) return {};
  return {
    "X-Provider-Config": Buffer.from(JSON.stringify(config), "utf8").toString("base64"),
  };
}

function envProvider() {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const model = process.env.OPENROUTER_MODEL;
  if (!model) {
    throw new Error("OPENROUTER_MODEL is required when OPENROUTER_API_KEY is set.");
  }
  return {
    draft: {
      provider: "openai-compatible",
      baseUrl: OPENROUTER_BASE_URL,
      apiKey: process.env.OPENROUTER_API_KEY,
      model,
    },
    postedit: null,
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${APP_URL}${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed with HTTP ${response.status}.`);
  }
  return data;
}

async function extractFile(filePath) {
  const absolutePath = resolve(filePath);
  const buffer = await readFile(absolutePath);
  const formData = new FormData();
  formData.append("file", new Blob([buffer]), basename(absolutePath));
  return requestJson("/api/extract", { method: "POST", body: formData });
}

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return JSON.parse(dataLines.join("\n"));
}

async function translateText(text, provider) {
  const response = await fetch(`${APP_URL}/api/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...providerHeader(provider),
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? `Translation failed with HTTP ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = new Map();
  const qaReports = [];
  let buffer = "";
  let finished = false;

  const syncText = () =>
    Array.from(chunks.keys())
      .sort((a, b) => a - b)
      .map((key) => chunks.get(key) ?? "")
      .join("");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (!event) continue;
      if (event.type === "delta") {
        const key = Number(event.chunk || 1);
        chunks.set(key, `${chunks.get(key) ?? ""}${event.text ?? ""}`);
      } else if (event.type === "replace_chunk") {
        const key = Number(event.chunk || 1);
        const prefix = String(chunks.get(key) ?? "").startsWith("\n\n") ? "\n\n" : "";
        chunks.set(key, `${prefix}${event.text ?? ""}`);
      } else if (event.type === "qa") {
        qaReports.push(event.report);
      } else if (event.type === "error") {
        throw new Error(String(event.message ?? "Translation failed."));
      } else if (event.type === "done") {
        finished = true;
      }
    }
  }

  if (!finished) throw new Error("Translation stream ended before completion.");
  return { text: syncText(), qaReports };
}

async function exportTranslation({ text, filename, format, images, outputPath }) {
  const response = await fetch(`${APP_URL}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, filename, format, images: format === "docx" ? images : [] }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? `Export failed with HTTP ${response.status}.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const finalPath = resolve(outputPath);
  await writeFile(finalPath, buffer);
  return { outputPath: finalPath, bytes: buffer.length };
}

const server = new McpServer({
  name: "academic-thai-translator",
  version: "0.1.0",
});

server.registerTool(
  "translator_health",
  {
    title: "Translator Health",
    description: "Check whether the local translator app API is reachable.",
    inputSchema: {},
  },
  async () => {
    const engines = await requestJson("/api/engines");
    return textResult({ appUrl: APP_URL, engines });
  }
);

server.registerTool(
  "extract_document",
  {
    title: "Extract Document",
    description: "Extract text and captured figure metadata from a local document using the translator app.",
    inputSchema: {
      filePath: z.string().describe("Absolute or relative path to .docx, .pdf, .txt, .png, or .jpg."),
      includeImages: z.boolean().optional().describe("Return base64 image payloads. Defaults to false."),
    },
  },
  async ({ filePath, includeImages = false }) => {
    const extracted = await extractFile(filePath);
    return textResult({
      text: extracted.text,
      meta: extracted.meta,
      images: includeImages
        ? extracted.images
        : extracted.images?.map(withoutImageData),
    });
  }
);

server.registerTool(
  "translate_text_to_thai",
  {
    title: "Translate Text To Thai",
    description: "Translate provided text into formal academic Thai.",
    inputSchema: {
      text: z.string(),
      provider: PipelineSchema.optional().describe("Optional provider override. If omitted, app/server env settings are used."),
    },
  },
  async ({ text, provider }) => {
    const translated = await translateText(text, provider);
    return textResult({
      thaiText: translated.text,
      qaReports: translated.qaReports,
    });
  }
);

server.registerTool(
  "translate_file_to_thai",
  {
    title: "Translate File To Thai",
    description: "Extract a local file, translate it, and export a Thai .docx or .txt file.",
    inputSchema: {
      filePath: z.string(),
      outputPath: z.string().optional(),
      format: z.enum(["docx", "txt"]).optional(),
      provider: PipelineSchema.optional().describe("Optional provider override. If omitted, app/server env settings are used."),
    },
  },
  async ({ filePath, outputPath, format = "docx", provider }) => {
    const extracted = await extractFile(filePath);
    const translated = await translateText(extracted.text, provider);
    const sourcePath = resolve(filePath);
    const base = basename(sourcePath, extname(sourcePath));
    const finalOutputPath = outputPath ?? join(dirname(sourcePath), `${base}-thai.${format}`);
    const exported = await exportTranslation({
      text: translated.text,
      filename: basename(sourcePath),
      format,
      images: extracted.images ?? [],
      outputPath: finalOutputPath,
    });
    return textResult({
      ...exported,
      sourceMeta: extracted.meta,
      qaReports: translated.qaReports,
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
