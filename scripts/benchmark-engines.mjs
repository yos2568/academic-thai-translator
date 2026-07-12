#!/usr/bin/env node
// Runs the same fixture document through multiple provider configurations
// against a running app instance and prints a latency/QA comparison table.
// Usage:
//   node scripts/benchmark-engines.mjs [fixturePath] [providersPath]
// Defaults: tests/fixtures/digital-sample.txt, benchmark-providers.json
//
// providersPath is a JSON array of:
//   { "name": "typhoon-ollama", "draft": {...ProviderConfig}, "postedit": null | {...ProviderConfig} }
// See benchmark-providers.example.json for the shape.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const APP_URL = (process.env.TRANSLATOR_APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

async function loadProviders(path) {
  const raw = await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Providers file must be a non-empty JSON array of { name, draft, postedit }.");
  }
  return parsed;
}

function encodeProviderHeader(entry) {
  return Buffer.from(JSON.stringify({ draft: entry.draft, postedit: entry.postedit ?? null }), "utf8").toString("base64");
}

async function readSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data: ")) continue;
      onEvent(JSON.parse(line.slice(6)));
    }
  }
}

async function benchmarkOne(entry, text) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(`${APP_URL}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Provider-Config": encodeProviderHeader(entry) },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    return { name: entry.name, ok: false, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started };
  }
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    return { name: entry.name, ok: false, error: body.error ?? `HTTP ${response.status}`, elapsedMs: Date.now() - started };
  }

  const chunkText = {};
  let qaPass = 0;
  let qaTotal = 0;
  let errorMessage = null;
  await readSse(response, (event) => {
    if (event.type === "delta") chunkText[event.chunk] = (chunkText[event.chunk] ?? "") + event.text;
    else if (event.type === "replace_chunk") chunkText[event.chunk] = event.text;
    else if (event.type === "qa") {
      qaTotal += 1;
      if (event.report.passed) qaPass += 1;
    } else if (event.type === "error") errorMessage = event.message;
  });

  const elapsedMs = Date.now() - started;
  if (errorMessage) return { name: entry.name, ok: false, error: errorMessage, elapsedMs };

  const finalText = Object.keys(chunkText)
    .map(Number)
    .sort((a, b) => a - b)
    .map((key) => chunkText[key])
    .join("");
  return { name: entry.name, ok: true, elapsedMs, characters: finalText.length, qaPass, qaTotal };
}

function printTable(headers, rows) {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => String(row[i]).length)));
  const line = (cols) => cols.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  console.log("");
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

async function main() {
  const fixturePath = process.argv[2] ?? "tests/fixtures/digital-sample.txt";
  const providersPath = process.argv[3] ?? "benchmark-providers.json";

  const text = await readFile(resolve(fixturePath), "utf8");
  const providers = await loadProviders(providersPath);

  console.log(`Benchmarking ${providers.length} provider configuration(s) against ${fixturePath} (${text.length} chars) via ${APP_URL}`);

  const results = [];
  for (const entry of providers) {
    process.stdout.write(`  running ${entry.name}... `);
    const result = await benchmarkOne(entry, text);
    results.push(result);
    console.log(result.ok ? `${result.elapsedMs}ms` : `FAILED (${result.error})`);
  }

  printTable(
    ["Name", "Status", "Latency (ms)", "QA pass/total", "Output chars"],
    results.map((r) => [
      r.name,
      r.ok ? "ok" : "error",
      r.ok ? r.elapsedMs : "-",
      r.ok ? `${r.qaPass}/${r.qaTotal}` : r.error,
      r.ok ? r.characters : "-",
    ])
  );
}

main().catch((error) => {
  console.error("[benchmark] failed:", error);
  process.exitCode = 1;
});
