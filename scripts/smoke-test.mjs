#!/usr/bin/env node
// End-to-end smoke test: upload -> extract -> translate (against a stub
// openai-compatible provider) -> export, driven entirely over HTTP against
// a real `next start` server. No browser required.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const APP_PORT = 3921;
const STUB_PORT = 3922;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const STUB_THAI_REPLY = "การแปลเชิงวิชาการรักษาหลักฐานไว้ (Smith, 2020) และค่า 87.4% ต้องไม่เปลี่ยนแปลง";

function log(...args) {
  console.log("[smoke]", ...args);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

function startStubProvider() {
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: STUB_THAI_REPLY } }],
        })
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(STUB_PORT, "127.0.0.1", () => resolve(server));
  });
}

function spawnApp() {
  // next.config.ts sets output: "standalone"; "next start" warns and
  // ignores it, so run the traced standalone server directly (same
  // artifact the Dockerfile ships), pointed at .next/static and public
  // via a symlink-free copy done by scripts/package-standalone.mjs.
  const child = spawn("node", ["dist/academic-thai-translator/server.js"], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      ALLOW_PRIVATE_UPSTREAMS: "true", // stub provider runs on localhost
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.env.SMOKE_VERBOSE && process.stdout.write(`[next] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[next:err] ${chunk}`));
  return child;
}

function encodeProviderHeader(config) {
  return Buffer.from(JSON.stringify(config), "utf8").toString("base64");
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

async function main() {
  log("starting stub openai-compatible provider on", STUB_PORT);
  const stub = await startStubProvider();

  log("starting app (next start) on", APP_PORT);
  const app = spawnApp();

  try {
    await waitForHttp(APP_URL, 60_000);
    log("app is up");

    // 1. Extract
    const fixture = await readFile(new URL("../tests/fixtures/digital-sample.txt", import.meta.url));
    const form = new FormData();
    form.append("file", new Blob([fixture], { type: "text/plain" }), "digital-sample.txt");
    const extractRes = await fetch(`${APP_URL}/api/extract`, { method: "POST", body: form });
    if (!extractRes.ok) throw new Error(`extract failed: ${extractRes.status} ${await extractRes.text()}`);
    const extracted = await extractRes.json();
    if (!extracted.text || !extracted.text.includes("87.4%")) {
      throw new Error(`unexpected extracted text: ${JSON.stringify(extracted).slice(0, 300)}`);
    }
    log("extract ok:", JSON.stringify(extracted.text).slice(0, 80));

    // 2. Translate (SSE), routed at the stub provider
    const providerConfig = encodeProviderHeader({
      draft: {
        provider: "openai-compatible",
        baseUrl: `http://127.0.0.1:${STUB_PORT}`,
        apiKey: "test-key",
        model: "stub-model",
      },
      postedit: null,
    });
    const translateRes = await fetch(`${APP_URL}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Provider-Config": providerConfig },
      body: JSON.stringify({ text: extracted.text }),
    });
    if (!translateRes.ok || !translateRes.body) {
      throw new Error(`translate failed: ${translateRes.status} ${await translateRes.text()}`);
    }

    let thaiText = "";
    let sawDone = false;
    let qaReport = null;
    await readSse(translateRes, (event) => {
      if (event.type === "delta") thaiText += event.text;
      else if (event.type === "replace_chunk") thaiText = event.text;
      else if (event.type === "qa") qaReport = event.report;
      else if (event.type === "done") sawDone = true;
      else if (event.type === "error") throw new Error(`translate SSE error: ${event.message}`);
    });
    if (!sawDone) throw new Error("translate stream ended without a done event");
    if (!/[฀-๿]/.test(thaiText)) throw new Error(`no Thai text in output: ${thaiText}`);
    if (!qaReport) throw new Error("no QA report received");
    log("translate ok, QA passed:", qaReport.passed);

    // 3. Export
    const exportRes = await fetch(`${APP_URL}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: thaiText, format: "txt", filename: "smoke-test" }),
    });
    if (!exportRes.ok) throw new Error(`export failed: ${exportRes.status} ${await exportRes.text()}`);
    const exported = await exportRes.text();
    if (!/[฀-๿]/.test(exported)) throw new Error(`exported file has no Thai text: ${exported}`);
    log("export ok, length:", exported.length);

    log("SMOKE TEST PASSED");
  } finally {
    app.kill("SIGTERM");
    stub.close();
  }
}

main().catch((error) => {
  console.error("[smoke] SMOKE TEST FAILED:", error);
  process.exitCode = 1;
});
