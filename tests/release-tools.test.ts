// The release-metadata guard against throwaway repositories. This covers the
// failure we actually hit — a release tag on the commit before the version
// bump — and the Cloudflare tag family the guard did not previously know.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../bin/check-version", import.meta.url));
const setVersion = fileURLToPath(new URL("../bin/set-version", import.meta.url));

// The guard reads GITHUB_REF and runs git in a temp repository. Neither an
// ambient CI tag nor a developer's global git config may influence it.
const testEnv = {
  ...process.env,
  GITHUB_REF: "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

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
    { cwd, encoding: "utf8", env: testEnv },
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
    env: { ...testEnv, CHECK_VERSION_ROOT: root },
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

test("set-version changes only the manifest's top-level version", () => {
  const root = mkdtempSync(join(tmpdir(), "org-hats-set-version-"));
  try {
    const manifest = join(root, "package.json");
    const before = `{
  "name": "fixture",
  "version": "1.2.3",
  "description": "pinned at 1.2.3 for a reason",
  "dependencies": { "dep": "1.2.3" }
}
`;
    writeFileSync(manifest, before);
    const result = spawnSync(setVersion, [manifest, "1.2.4"], { encoding: "utf8", env: testEnv });
    assert.equal(result.status, 0, result.stderr);
    const after = readFileSync(manifest, "utf8");
    assert.equal(
      after,
      before.replace(`"version": "1.2.3"`, `"version": "1.2.4"`),
      "only the top-level version may move",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("set-version refuses a manifest without a version and leaves it untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "org-hats-set-version-"));
  try {
    const manifest = join(root, "package.json");
    const before = `{ "name": "fixture" }\n`;
    writeFileSync(manifest, before);
    const result = spawnSync(setVersion, [manifest, "1.2.4"], { encoding: "utf8", env: testEnv });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr ?? "", /version/);
    assert.equal(readFileSync(manifest, "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an untagged checkout is not an error", () => {
  const root = repo();
  try {
    const untagged = run(root);
    assert.equal(untagged.status, 0, untagged.stderr);
    assert.match(untagged.stdout ?? "", /no version tag at this checkout/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CI tag ref is audited from the checkout", () => {
  const root = repo();
  try {
    git(root, "tag", "-a", "v1.2.3", "-m", "v1.2.3");
    const ci = spawnSync(script, [], {
      cwd: root,
      env: { ...testEnv, CHECK_VERSION_ROOT: root, GITHUB_REF: "refs/tags/v1.2.3" },
      encoding: "utf8",
    });
    assert.equal(ci.status, 0, ci.stderr);
    assert.match(ci.stdout ?? "", /v1\.2\.3 matches package\.json 1\.2\.3/);
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
