// The release-metadata guard against throwaway repositories. This covers the
// failure we actually hit — a release tag on the commit before the version
// bump — and the Cloudflare tag family the guard did not previously know.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../bin/check-version", import.meta.url));

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c", "user.name=Release Test",
      "-c", "user.email=release@example.test",
      "-c", "commit.gpgsign=false",
      "-c", "tag.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );

const repo = (): string => {
  const root = mkdtempSync(join(tmpdir(), "org-hats-release-"));
  git(root, "init", "-q");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", version: "1.2.3" }, null, 2) + "\n");
  mkdirSync(join(root, "packages", "cloudflare"), { recursive: true });
  writeFileSync(
    join(root, "packages", "cloudflare", "package.json"),
    JSON.stringify({ name: "cloudflare", version: "0.1.0" }, null, 2) + "\n",
  );
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "release fixtures");
  return root;
};

const run = (root: string, ...args: string[]) =>
  spawnSync(script, args, {
    cwd: root,
    env: { ...process.env, CHECK_VERSION_ROOT: root },
    encoding: "utf8",
  });

test("both release-tag families are validated against their own manifest", () => {
  const root = repo();
  try {
    git(root, "tag", "-a", "v1.2.3", "-m", "v1.2.3");
    git(root, "tag", "-a", "cloudflare-v0.1.0", "-m", "cloudflare-v0.1.0");

    const rootTag = run(root, "v1.2.3");
    assert.equal(rootTag.status, 0, rootTag.stderr);
    assert.match(rootTag.stdout ?? "", /v1\.2\.3 matches package\.json 1\.2\.3/);

    const cloudflareTag = run(root, "cloudflare-v0.1.0");
    assert.equal(cloudflareTag.status, 0, cloudflareTag.stderr);
    assert.match(
      cloudflareTag.stdout ?? "",
      /cloudflare-v0\.1\.0 matches packages\/cloudflare\/package\.json 0\.1\.0/,
    );

    // No argument reads the tags at HEAD and checks each in its own family.
    const atHead = run(root);
    assert.equal(atHead.status, 0, atHead.stderr);
    assert.match(atHead.stdout ?? "", /v1\.2\.3 matches/);
    assert.match(atHead.stdout ?? "", /cloudflare-v0\.1\.0 matches/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a tag on the wrong commit or in the wrong family fails closed", () => {
  const root = repo();
  try {
    // The tag says 0.2.0, but the manifest at that commit says 0.1.0 —
    // exactly the tag-on-the-wrong-commit failure.
    git(root, "tag", "-a", "cloudflare-v0.2.0", "-m", "cloudflare-v0.2.0");
    const wrongVersion = run(root, "cloudflare-v0.2.0");
    assert.notEqual(wrongVersion.status, 0);
    assert.match(
      wrongVersion.stderr ?? "",
      /does not match packages\/cloudflare\/package\.json version 0\.1\.0/,
    );

    const notAReleaseTag = run(root, "cloudflare-1.2.3");
    assert.notEqual(notAReleaseTag.status, 0);
    assert.match(notAReleaseTag.stderr ?? "", /no such tag|not a release tag/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
