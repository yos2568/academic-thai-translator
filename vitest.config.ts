import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // "server-only" throws when required outside a bundler that sets the
    // "react-server" export condition (Next.js does; plain Node doesn't).
    // Alias it to the package's own no-op stub (by absolute path, bypassing
    // the package's "exports" map) so unit tests can import server-only
    // modules directly.
    alias: {
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
