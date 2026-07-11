#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(root, "dist", "academic-thai-translator");

async function copyIfExists(from, to) {
  try {
    await cp(from, to, { recursive: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await copyIfExists(join(root, ".next", "standalone"), outDir);
await copyIfExists(join(root, ".next", "static"), join(outDir, ".next", "static"));
await copyIfExists(join(root, "public"), join(outDir, "public"));
await copyIfExists(join(root, "scripts", "mcp-server.mjs"), join(outDir, "mcp-server.mjs"));
await copyIfExists(join(root, ".env.example"), join(outDir, ".env.example"));
await copyIfExists(join(root, "README.md"), join(outDir, "README.md"));
await copyIfExists(join(root, "package-lock.json"), join(outDir, "package-lock.json"));

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const runtimePackage = {
  name: packageJson.name,
  version: packageJson.version,
  private: true,
  scripts: {
    start: "node server.js",
    mcp: "node mcp-server.mjs",
  },
  dependencies: packageJson.dependencies,
};

await writeFile(join(outDir, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);

await writeFile(
  join(outDir, "RUN.md"),
  `# Academic Thai Translator Standalone Bundle

## Run the app

\`\`\`bash
npm install --omit=dev
npm start
\`\`\`

Open http://localhost:3000.

For OpenRouter as the default provider, create a .env file next to server.js:

\`\`\`dotenv
LOCAL_OPENAI_BASE_URL=https://openrouter.ai/api/v1
LOCAL_OPENAI_API_KEY=your-openrouter-key
LOCAL_OPENAI_MODEL=openrouter-model-name
\`\`\`

## Run as MCP

Start the app first, then configure your MCP client to run:

\`\`\`bash
npm run mcp
\`\`\`

Useful MCP environment variables:

\`\`\`dotenv
TRANSLATOR_APP_URL=http://127.0.0.1:3000
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=openrouter-model-name
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
\`\`\`

System prerequisites for OCR and PDF image capture:

- Tesseract with English and Thai language data
- Poppler utilities
`,
  "utf8"
);

console.log(`Standalone bundle created at ${outDir}`);
