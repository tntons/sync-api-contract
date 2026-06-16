# sync-api-contract

A GitHub Action that propagates a shared API contract (the **source** repo)
into one or more **consumer** repositories as `vendor/` pull requests.

This is the implementation that backs the WriterBridge contract sync. It is
generic enough to use with any source-of-truth repo that exposes plain text
or TypeScript files.

## What it does

1. Reads a list of files (the `source-paths`) from the source repository at
   the configured ref.
2. For each consumer repository listed in `consumers`, computes a diff
   against the corresponding files in the consumer's `destination-base`
   folder.
3. If the diff is non-empty, opens (or updates) a pull request on the
   consumer with the new files. The PR is labelled `api-contract-sync` and
   pointed at the consumer's default branch.
4. If the diff is empty, closes any open sync PR on the consumer.
5. Reports which consumers were opened, updated, closed, or failed.

## Inputs

| Input | Required | Description |
| --- | --- | --- |
| `source-repo` | no (defaults to the triggering repo) | `owner/name` of the source contract repo. |
| `source-ref` | no (defaults to the triggering ref) | Branch, tag, or SHA to read from. |
| `source-paths` | **yes** | Comma-separated paths inside the source repo, e.g. `index.js,index.d.ts`. |
| `consumers` | **yes** | Newline-separated list of consumer specs (see below). |
| `destination-base` | **yes** | Base path inside each consumer, e.g. `vendor/api-contract`. |
| `pr-title` | no | Title template for the sync PR. |
| `pr-body` | no | Body template for the sync PR. |
| `pr-branch` | no | Branch name to use (default: `chore/sync-api-contract`). |
| `pr-label` | no | Label to apply (default: `api-contract-sync`). |
| `commit-message` | no | Commit message used for the vendor copy. |
| `fail-on-error` | no | If `true`, the action fails the workflow on any consumer error. |

### Consumer spec

Each line of the `consumers` input has the form:

```
owner/name:branch:token-secret-name:Commit Author <author@example.com>
```

- `owner/name` — the consumer repository.
- `branch` — the base branch the PR should target (default `main`).
- `token-secret-name` — the name of the GitHub Actions **secret** in the
  source workflow's environment that holds a token with `contents: write`
  and `pull-requests: write` on the consumer.
- `Commit Author <author@example.com>` — the Git author used for the PR
  commit. Wrap in double quotes in the workflow YAML.

## Outputs

- `prs-opened` — newline-separated list of consumers where a PR was opened.
- `prs-updated` — newline-separated list of consumers where an existing PR
  was updated.
- `prs-closed` — newline-separated list of consumers where the PR was closed
  (no diff).
- `errors` — newline-separated list of consumers that failed to sync.

## Example usage

In the source contract repo's `.github/workflows/sync.yml`:

```yaml
name: sync contract

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: tntons/sync-api-contract@v1
        with:
          source-paths: index.js,index.d.ts
          destination-base: vendor/api-contract
          consumers: |
            tntons/writer-frontend:main:CONSUMER_TOKEN_FRONTEND:"Frontend Bot <actions@tntons.com>"
            tntons/writer-backend:main:CONSUMER_TOKEN_BACKEND:"Backend Bot <actions@tntons.com>"
```

Each consumer repository must define the matching `CONSUMER_TOKEN_*` secret
in the source workflow's environment, with a Personal Access Token (or
GitHub App installation token) that has write access to the consumer.

## Local development

```bash
npm install
npm test
```

The unit tests in `test/sync.test.js` exercise the diff logic and the
`parseAuthor` helper. End-to-end testing requires a real GitHub
environment; the action is small enough that the unit tests cover the
tricky bits.
