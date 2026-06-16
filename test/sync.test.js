"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { diff, parseAuthor, encodeBase64, decodeBase64 } = require("../src/sync");

test("diff detects added, modified, and unchanged files", () => {
  const source = {
    "index.js": { content: "A", destinationPath: "vendor/api-contract/index.js" },
    "index.d.ts": { content: "B", destinationPath: "vendor/api-contract/index.d.ts" },
  };
  const dest = {
    "index.js": { content: "A-old", destinationPath: "vendor/api-contract/index.js", sha: "sha1" },
    "index.d.ts": { content: "B", destinationPath: "vendor/api-contract/index.d.ts", sha: "sha2" },
  };
  const changes = diff(source, dest);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "index.js");
  assert.equal(changes[0].newContent, "A");
  assert.equal(changes[0].existingSha, "sha1");
});

test("parseAuthor accepts 'Name <email>'", () => {
  assert.deepEqual(parseAuthor("Frontend Bot <bot@example.com>"), {
    name: "Frontend Bot",
    email: "bot@example.com",
  });
});

test("parseAuthor rejects malformed strings", () => {
  assert.throws(() => parseAuthor("not-an-author"));
});

test("base64 round trip preserves utf-8", () => {
  const sample = "héllo 🚀\n{\"a\":1}";
  const b64 = encodeBase64(sample);
  assert.equal(decodeBase64(b64), sample);
});

test("diff returns empty when source and dest match", () => {
  const source = { "index.js": { content: "X", destinationPath: "vendor/api-contract/index.js" } };
  const dest = { "index.js": { content: "X", destinationPath: "vendor/api-contract/index.js", sha: "x" } };
  assert.deepEqual(diff(source, dest), []);
});
