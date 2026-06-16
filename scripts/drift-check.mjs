#!/usr/bin/env node
// drift-check.mjs — fail (exit 1) if vendor/api-contract/ has drifted from
// tntons/writer-api-contract@<ref>.
//
// Usage:
//   node scripts/drift-check.mjs [ref] [vendor-dir]
//   ref         - git ref in tntons/writer-api-contract (default: main)
//   vendor-dir  - local vendor directory (default: vendor/api-contract)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const REPO = "tntons/writer-api-contract";
const ref = process.argv[2] || "main";
const vendorDir = process.argv[3] || "vendor/api-contract";

function decodeBase64(content) {
  return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function fetchSource(path) {
  const url = `https://api.github.com/repos/${REPO}/contents/${path}?ref=${ref}`;
  // Try the GITHUB_TOKEN env var first (set automatically in CI), then
  // gh CLI's stored token, then anonymous.
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    try {
      const { execFileSync } = await import("node:child_process");
      token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    } catch (_) {
      // gh CLI not available or not authed; proceed anonymously (will 404
      // for private repos).
      if (process.env.GITHUB_ACTIONS) {
        console.error("note: no GITHUB_TOKEN and no gh CLI auth; using anonymous requests");
      }
    }
  }
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers });
  if (res.status === 404) {
    throw new Error(`Source file not found: ${REPO}@${ref}:${path}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return decodeBase64(json.content);
}

async function readLocal(path) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function sha(s) {
  return createHash("sha256").update(s).digest("hex");
}

async function main() {
  const paths = ["index.js", "index.d.ts"];
  const sourceFiles = {};
  for (const p of paths) {
    sourceFiles[p] = await fetchSource(p);
  }

  let drifted = false;
  for (const p of paths) {
    const localPath = join(vendorDir, p);
    const local = await readLocal(localPath);
    if (local === null) {
      console.error(`MISSING  ${localPath}`);
      drifted = true;
      continue;
    }
    if (sha(local) !== sha(sourceFiles[p])) {
      console.error(`DRIFT    ${localPath}`);
      drifted = true;
    } else {
      console.log(`ok       ${localPath}`);
    }
  }

  if (drifted) {
    console.error("");
    console.error("vendor/api-contract/ is out of sync with tntons/writer-api-contract@${ref}.");
    console.error("Run the sync workflow (or `bash scripts/vendor.sh`) to refresh.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(2);
});
