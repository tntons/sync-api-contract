"use strict";

const core = require("@actions/core");
const github = require("@actions/github");
const { syncConsumer } = require("./sync");

function parseList(input, separator) {
  if (!input) return [];
  return input
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseConsumers(input) {
  // Each line: owner/name:branch:token-secret:commit-author
  return parseList(input, "\n").map((line) => {
    const [repo, branch = "main", tokenSecret, author = "sync-api-contract <actions@github.com>"] = line.split(":");
    if (!repo || !tokenSecret) {
      throw new Error(
        `Invalid consumer line (expected owner/name:branch:token-secret:author): ${line}`
      );
    }
    const token = process.env[tokenSecret];
    if (!token) {
      throw new Error(`Secret ${tokenSecret} is not set for consumer ${repo}`);
    }
    return { repo, branch, token, tokenSecret, author };
  });
}

function parseSourcePaths(input) {
  return parseList(input, ",");
}

function renderTemplate(template, vars) {
  return template
    // GitHub Actions ${{ inputs.X }} style (works in workflow YAML).
    .replace(/\${{\s*inputs\.([a-z0-9-]+)\s*}}/gi, (_, key) =>
      vars[key] == null ? "" : String(vars[key])
    )
    // Plain {X} placeholders (works in action.yml defaults where the
    // ${{ inputs.X }} form is rejected).
    .replace(/\{([a-z0-9-]+)\}/gi, (_, key) =>
      vars[key] == null ? "" : String(vars[key])
    );
}

async function run() {
  try {
    const inputs = {
      "source-repo": core.getInput("source-repo"),
      "source-ref": core.getInput("source-ref"),
      "source-sha": core.getInput("source-sha") || core.getInput("source-ref"),
      "source-paths": core.getInput("source-paths"),
      consumers: core.getInput("consumers"),
      "destination-base": core.getInput("destination-base"),
      "pr-title": core.getInput("pr-title"),
      "pr-body": core.getInput("pr-body"),
      "pr-branch": core.getInput("pr-branch"),
      "pr-label": core.getInput("pr-label"),
      "commit-message": core.getInput("commit-message"),
      "fail-on-error": core.getInput("fail-on-error") || "true",
    };

    const sourceRepo = inputs["source-repo"];
    const sourceRef = inputs["source-ref"];
    const sourcePaths = parseSourcePaths(inputs["source-paths"]);
    const consumers = parseConsumers(inputs.consumers);
    const destinationBase = inputs["destination-base"].replace(/^\/|\/$/g, "");
    const failOnError = inputs["fail-on-error"].toLowerCase() === "true";

    if (sourcePaths.length === 0) {
      throw new Error("source-paths must list at least one path");
    }
    if (consumers.length === 0) {
      throw new Error("consumers must list at least one consumer");
    }

    // The source's token is the default GITHUB_TOKEN. Consumers each use
    // their own secret.
    const sourceToken = process.env.GITHUB_TOKEN;
    if (!sourceToken) {
      throw new Error("GITHUB_TOKEN is not set; required to read the source repo");
    }
    const sourceOctokit = github.getOctokit(sourceToken);

    const title = renderTemplate(inputs["pr-title"], inputs);
    const body = renderTemplate(inputs["pr-body"], inputs);
    const branch = renderTemplate(inputs["pr-branch"], inputs);
    const label = renderTemplate(inputs["pr-label"], inputs);
    const commitMessage = renderTemplate(inputs["commit-message"], inputs);

    core.info(`Source: ${sourceRepo}@${sourceRef}`);
    core.info(`Destination base: ${destinationBase}`);
    core.info(`Consumers: ${consumers.map((c) => c.repo).join(", ")}`);

    const prsOpened = [];
    const prsUpdated = [];
    const prsClosed = [];
    const errors = [];

    for (const consumer of consumers) {
      try {
        const consumerOctokit = github.getOctokit(consumer.token);
        const result = await syncConsumer({
          octokit: consumerOctokit,
          sourceOctokit,
          sourceRepo,
          sourceRef,
          sourcePaths,
          destinationBase,
          consumer,
          title,
          body,
          branch,
          label,
          commitMessage,
        });
        if (result === "opened") prsOpened.push(consumer.repo);
        else if (result === "updated") prsUpdated.push(consumer.repo);
        else if (result === "closed") prsClosed.push(consumer.repo);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        core.error(`Failed to sync ${consumer.repo}: ${msg}`);
        errors.push(`${consumer.repo}: ${msg}`);
      }
    }

    core.setOutput("prs-opened", prsOpened.join("\n"));
    core.setOutput("prs-updated", prsUpdated.join("\n"));
    core.setOutput("prs-closed", prsClosed.join("\n"));
    core.setOutput("errors", errors.join("\n"));

    if (errors.length > 0 && failOnError) {
      core.setFailed(`${errors.length} consumer(s) failed to sync`);
    }
  } catch (err) {
    core.setFailed(err && err.message ? err.message : String(err));
  }
}

run();
