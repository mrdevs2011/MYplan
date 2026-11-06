import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { NextConfig } from "next";

// One id per deployment: the commit being built (Vercel provides it; locally git does). The running app compares it
// with /version.json, which every deployment serves, and reloads itself when they differ.
function currentBuildId(): string {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromCi) return fromCi;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}
const BUILD_ID = currentBuildId();
try {
  const file = "public/version.json";
  const body = JSON.stringify({ id: BUILD_ID });
  let existing = "";
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    existing = "";
  }
  if (existing !== body) writeFileSync(file, body);
} catch {
  // A read-only file system only means no update check; the app itself is unaffected.
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  async headers() {
    return [
      {
        // The service worker must never be served stale, or fixes and new push logic would not reach devices.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Never cached anywhere: this is how open and returning users learn that a new version is live.
        source: "/version.json",
        headers: [
          { key: "Content-Type", value: "application/json; charset=utf-8" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
