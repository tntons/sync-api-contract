# sync-api-contract — runbook

This repository hosts the GitHub Action used by WriterBridge to
propagate a shared API contract (the **source** repo) into one or
more **consumer** repositories as `vendor/` pull requests.

## When to bump the major version tag (`v1`)

A new major version is appropriate when:

- You change the input contract (input names, types, required/optional)
  in a backward-incompatible way.
- You change the default behavior in a way that requires explicit opt-in
  on the consumer side.

For most changes (bug fixes, new optional inputs, additional consumers),
bump the patch or minor version on the existing major tag.

## How to release a new version

1. Make your changes on a feature branch.
2. Run `npm install` and `npm test` locally. All tests should pass.
3. Run `npm run build` to rebuild `dist/index.js`.
4. Commit the source changes **and** the updated `dist/index.js`.
5. Push the branch and open a PR.
6. After the PR is merged, force-update the major tag:
   ```bash
   git tag -fa v1 -m "v1"
   git push origin v1 --force
   ```
7. Optionally create a versioned tag for the release:
   ```bash
   git tag -a v1.x.y -m "v1.x.y: <summary>"
   git push origin v1.x.y
   ```

Consumers should reference the major tag (`@v1`) to pick up bug fixes
automatically, or pin a specific version (`@v1.2.3`) for stricter
reproducibility.

## Inputs reference

| Input | Required | Description |
| --- | --- | --- |
| `source-repo` | no (defaults to the triggering repo) | `owner/name` of the source contract repo. |
| `source-ref` | no (defaults to the triggering ref) | Branch, tag, or SHA to read from. |
| `source-sha` | no (falls back to `source-ref`) | Exact source commit SHA. |
| `source-token` | no (falls back to `GITHUB_TOKEN` env) | Token with read access to the source repo. |
| `source-paths` | **yes** | Comma-separated paths inside the source repo. |
| `consumers` | **yes** | Newline-separated consumer specs. |
| `destination-base` | **yes** | Base path inside each consumer. |
| `pr-title` | no | Title template for the sync PR. Supports `{X}` and `${{ inputs.X }}` placeholders. |
| `pr-body` | no | Body template for the sync PR. |
| `pr-branch` | no | Branch name to use. |
| `pr-label` | no | Label to apply. |
| `commit-message` | no | Commit message used for the vendor copy. |
| `fail-on-error` | no | If `true`, the action fails the workflow on any consumer error. |

## Consumer spec format

```
owner/name:branch:token-secret-name:"Commit Author <author@example.com>"
```

- `owner/name` — the consumer repository.
- `branch` — the base branch the PR should target (default `main`).
- `token-secret-name` — the name of the GitHub Actions **env var** (not
  secret directly) holding a token with `contents: write` and
  `pull-requests: write` on the consumer. Map the secret in the
  workflow's `env:` block.
- `Commit Author <author@example.com>` — the Git author for the PR
  commit. Quote the value in the workflow YAML if it contains a colon
  or angle bracket.

## Testing locally

```bash
npm install
npm test
```

The unit tests in `test/sync.test.js` exercise the diff logic and the
`parseAuthor` helper. End-to-end testing requires a real GitHub
environment.

## Failure modes

- **"action.yml" errors at workflow parse time.** The action.yml uses
  `${{ inputs.X }}` in workflow examples and `{X}` placeholders in
  default values. Default values cannot reference inputs.
- **"Cannot find module '@actions/core'".** Run `npm run build` and
  commit the updated `dist/index.js`.
- **"Secret X is not set".** Map the secret in the workflow's `env:`
  block, not as a direct input. The action reads `process.env[X]`.
