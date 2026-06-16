#!/usr/bin/env bash
# vendor.sh — copy a contract from tntons/writer-api-contract@main into
# ./vendor/api-contract/. Used by consumers to seed their initial copy.
set -euo pipefail

REPO="${1:-tntons/writer-api-contract}"
REF="${2:-main}"
DEST="${3:-vendor/api-contract}"

if ! command -v gh >/dev/null; then
  echo "gh CLI is required (https://cli.github.com)" >&2
  exit 1
fi

mkdir -p "$DEST"

for path in index.js index.d.ts; do
  gh api "repos/${REPO}/contents/${path}?ref=${REF}" --jq '.content' \
    | tr -d '\n' | base64 -d > "${DEST}/${path}"
  echo "wrote ${DEST}/${path}"
done
