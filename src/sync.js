"use strict";

const path = require("path");

// Encode a path the way GitHub Contents API expects it.
function encodePath(p) {
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function decodeBase64(content) {
  // GitHub returns base64 with newlines; strip them.
  return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
}

function encodeBase64(content) {
  return Buffer.from(content, "utf8").toString("base64");
}

async function getFile(octokit, owner, repo, ref, filePath) {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref,
    });
    if (Array.isArray(res.data)) return null; // a directory
    if (res.data.type !== "file") return null;
    return {
      content: decodeBase64(res.data.content),
      sha: res.data.sha,
    };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// Fetch every source file in one pass.
async function fetchSourceFiles({ sourceOctokit, sourceRepo, sourceRef, sourcePaths }) {
  const [owner, repo] = sourceRepo.split("/");
  const out = {};
  for (const p of sourcePaths) {
    const file = await getFile(sourceOctokit, owner, repo, sourceRef, p);
    if (!file) {
      throw new Error(`Source file not found at ${sourceRepo}@${sourceRef}:${p}`);
    }
    out[p] = file;
  }
  return out;
}

// Fetch every destination file (returns {} if the folder doesn't exist).
async function fetchDestinationFiles({ octokit, owner, repo, ref, destinationBase, sourcePaths }) {
  const out = {};
  for (const p of sourcePaths) {
    const destPath = path.posix.join(destinationBase, p);
    const file = await getFile(octokit, owner, repo, ref, destPath);
    if (file) out[p] = { ...file, destinationPath: destPath };
    else out[p] = { content: null, sha: null, destinationPath: destPath };
  }
  return out;
}

function diff(sourceFiles, destFiles) {
  const changes = [];
  for (const p of Object.keys(sourceFiles)) {
    const src = sourceFiles[p].content;
    const dst = destFiles[p].content;
    if (src !== dst) {
      changes.push({
        path: p,
        destinationPath: destFiles[p].destinationPath,
        newContent: src,
        existingSha: destFiles[p].sha,
      });
    }
  }
  return changes;
}

async function ensureLabel(octokit, owner, repo, name) {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name });
  } catch (err) {
    if (err.status !== 404) throw err;
    try {
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name,
        color: "0E8A16",
        description: "Pull request opened automatically by sync-api-contract",
      });
    } catch (createErr) {
      // Ignore if another run created it concurrently.
      if (createErr.status !== 422) throw createErr;
    }
  }
}

async function findExistingPr(octokit, owner, repo, branch, label) {
  const q = `repo:${owner}/${repo} is:pr is:open head:${branch} label:"${label}"`;
  const res = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 1 });
  return res.data.items[0] || null;
}

function parseAuthor(author) {
  // Strip surrounding quotes if present, then match "Name <email>".
  const cleaned = author.replace(/^\s*["\']|["\']\s*$/g, "");
  const m = cleaned.match(/^\s*([^<]+?)\s*<([^>]+)>\s*$/);
  if (!m) {
    throw new Error(`commit-author must be in the form \"Name <email>\": ${author}`);
  }
  return { name: m[1].trim(), email: m[2].trim() };
}

async function getBaseBranchSha(octokit, owner, repo, branch) {
  const res = await octokit.rest.repos.getBranch({ owner, repo, branch });
  return res.data.commit.sha;
}

async function createBranch(octokit, owner, repo, baseSha, newBranch) {
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${newBranch}`,
    sha: baseSha,
  });
}

async function commitFiles({
  octokit,
  owner,
  repo,
  branch,
  parentSha,
  changes,
  author,
  message,
}) {
  // Build a single-tree commit by chaining blob creates.
  const blobs = await Promise.all(
    changes.map((c) =>
      octokit.rest.git.createBlob({
        owner,
        repo,
        content: c.newContent,
        encoding: "utf-8",
      }).then((res) => ({ ...c, sha: res.data.sha }))
    )
  );

  const tree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: parentSha,
    tree: blobs.map((b) => ({
      path: b.destinationPath,
      mode: "100644",
      type: "blob",
      sha: b.sha,
    })),
  });

  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.data.sha,
    parents: [parentSha],
    author,
    committer: author,
  });

  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  });

  return commit.data.sha;
}

async function openOrUpdatePrWithAuthor({
  octokit,
  owner,
  repo,
  branch,
  base,
  title,
  body,
  label,
  changes,
  author,
  commitMessage,
}) {
  await ensureLabel(octokit, owner, repo, label);

  const baseSha = await getBaseBranchSha(octokit, owner, repo, base);
  const existingPr = await findExistingPr(octokit, owner, repo, branch, label);

  let isNewBranch = false;
  try {
    await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  } catch (err) {
    if (err.status !== 404) throw err;
    isNewBranch = true;
    await createBranch(octokit, owner, repo, baseSha, branch);
  }

  const parentSha = isNewBranch
    ? baseSha
    : (await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` })).data.object.sha;

  await commitFiles({
    octokit,
    owner,
    repo,
    branch,
    parentSha,
    changes,
    author,
    message: commitMessage,
  });

  if (existingPr) {
    return { result: "updated", pr: existingPr };
  }

  const pr = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    head: branch,
    base,
    body,
    maintainer_can_modify: true,
  });
  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: pr.data.number,
    labels: [label],
  });
  return { result: "opened", pr: pr.data };
}

async function closePrIfNoChanges({ octokit, owner, repo, branch, label }) {
  const existing = await findExistingPr(octokit, owner, repo, branch, label);
  if (!existing) return "closed"; // nothing to close
  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: existing.number,
    state: "closed",
  });
  return "closed";
}

async function syncConsumer({
  octokit,
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
}) {
  const [owner, repo] = consumer.repo.split("/");
  const author = parseAuthor(consumer.author);

  const sourceFiles = await fetchSourceFiles({
    sourceOctokit,
    sourceRepo,
    sourceRef,
    sourcePaths,
  });

  const destFiles = await fetchDestinationFiles({
    octokit,
    owner,
    repo,
    ref: consumer.branch,
    destinationBase,
    sourcePaths,
  });

  const changes = diff(sourceFiles, destFiles);

  if (changes.length === 0) {
    core_info(`No diff for ${consumer.repo}; closing any open sync PR.`);
    return await closePrIfNoChanges({
      octokit,
      owner,
      repo,
      branch,
      label,
    });
  }

  core_info(`Syncing ${changes.length} file(s) to ${consumer.repo}`);
  const { result } = await openOrUpdatePrWithAuthor({
    octokit,
    owner,
    repo,
    branch,
    base: consumer.branch,
    title,
    body,
    label,
    changes,
    author,
    commitMessage,
  });
  return result;
}

function core_info(msg) {
  // Lazy require so the action entry point is the one that registers @actions/core
  // for the actual log functions; this fallback keeps the module independently
  // importable in unit tests.
  try {
    const core = require("@actions/core");
    core.info(msg);
  } catch (_) {
    // eslint-disable-next-line no-console
    console.log(msg);
  }
}

module.exports = {
  syncConsumer,
  // Exported for tests:
  fetchSourceFiles,
  fetchDestinationFiles,
  diff,
  parseAuthor,
  encodePath,
  decodeBase64,
  encodeBase64,
};
