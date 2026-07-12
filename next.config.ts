import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow opening the dev app via LAN IP (e.g. http://192.168.x.x:3000).
  // Without this, Next.js 16 blocks /_next/* chunks and HMR → buttons appear dead.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "192.168.1.50",
    "192.168.0.0/16",
    "10.0.0.0/8",
  ],
  serverExternalPackages: ["pdf-parse", "mammoth"],
  outputFileTracingIncludes: {
    "/api/extract": [
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-*/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const scriptPolicy = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    // Dev: allow HMR websocket + local network origins so LAN testing works.
    const connectPolicy = isDev
      ? "connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:* http://192.168.*:*"
      : "connect-src 'self'";
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; ${connectPolicy}; frame-ancestors 'none'`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
