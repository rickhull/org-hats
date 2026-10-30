// The release-metadata guard against throwaway repositories. This covers the
// failure we actually hit — a release tag on the commit before the version
// bump — and the Cloudflare tag family the guard did not previously know.
// The release script's publication posture is covered here too: it pushes by
// default, attempts every push, and exits nonzero when any of them fails.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../bin/check-version", import.meta.url));
const setVersion = fileURLToPath(new URL("../bin/set-version", import.meta.url));
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

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

test("[P6] both release-tag families are validated against their own manifest", () => {
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

// --- the release script's publication posture ---------------------------------

const releaseFixture = (): {
  root: string;
  base: string;
  origin: string;
  github: string;
  env: NodeJS.ProcessEnv;
} => {
  const base = mkdtempSync(join(tmpdir(), "org-hats-release-push-"));
  const root = join(base, "work");
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "dist"));
  mkdirSync(join(root, "packages", "cloudflare"), { recursive: true });
  for (const name of ["release", "set-version", "check-version"]) {
    copyFileSync(join(projectRoot, "bin", name), join(root, "bin", name));
    chmodSync(join(root, "bin", name), 0o755);
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", version: "1.2.3" }, null, 2) + "\n");
  writeFileSync(join(root, "dist", "index.js"), "export {};\n");
  writeFileSync(
    join(root, "packages", "cloudflare", "package.json"),
    JSON.stringify({ name: "cloudflare", version: "0.1.0" }, null, 2) + "\n",
  );
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Release Test");
  git(root, "config", "user.email", "release@example.test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "tag.gpgsign", "false");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "release fixtures");

  const origin = join(base, "origin.git");
  const github = join(base, "github.git");
  git(base, "init", "-q", "--bare", origin);
  git(base, "init", "-q", "--bare", github);
  git(root, "remote", "add", "origin", origin);
  git(root, "remote", "add", "github", github);

  // The release runs `pnpm build` without the gates; the fixture supplies a
  // no-op so the script is exercised, not the workspace.
  const path = join(base, "path");
  mkdirSync(path);
  writeFileSync(join(path, "pnpm"), "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
  const env = { ...testEnv, PATH: `${path}:${process.env["PATH"] ?? ""}` };
  return { root, base, origin, github, env };
};

const release = (fixture: ReturnType<typeof releaseFixture>, ...args: string[]) =>
  spawnSync(join(fixture.root, "bin", "release"), args, {
    cwd: fixture.root,
    env: fixture.env,
    encoding: "utf8",
  });

const tagCommit = (base: string, bare: string, tag: string): string =>
  git(base, "-C", bare, "rev-parse", "--verify", `refs/tags/${tag}^{}`).trim();

test("the release publishes to both hosts by default", () => {
  const fixture = releaseFixture();
  try {
    const result = release(fixture, "patch", "--no-verify");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout ?? "", /published branch and v1\.2\.4 to origin and github/);

    const head = git(fixture.root, "rev-parse", "HEAD").trim();
    assert.equal(git(fixture.base, "-C", fixture.origin, "rev-parse", "refs/heads/main").trim(), head);
    assert.equal(git(fixture.base, "-C", fixture.github, "rev-parse", "refs/heads/main").trim(), head);
    assert.equal(tagCommit(fixture.base, fixture.origin, "v1.2.4"), head);
    assert.equal(tagCommit(fixture.base, fixture.github, "v1.2.4"), head);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("--no-push keeps the tag local and prints the publication commands", () => {
  const fixture = releaseFixture();
  try {
    const result = release(fixture, "patch", "--no-verify", "--no-push");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout ?? "", /not published; push with/);

    const head = git(fixture.root, "rev-parse", "HEAD").trim();
    assert.equal(git(fixture.root, "rev-parse", "--verify", "refs/tags/v1.2.4^{}").trim(), head);
    const remoteTag = spawnSync(
      "git",
      ["-C", fixture.origin, "rev-parse", "--verify", "refs/tags/v1.2.4"],
      { encoding: "utf8", env: testEnv },
    );
    assert.notEqual(remoteTag.status, 0, "the origin must not receive a --no-push release");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a failed push is reported per push, continues best-effort, and exits nonzero", () => {
  const fixture = releaseFixture();
  try {
    git(fixture.root, "remote", "set-url", "origin", join(fixture.base, "missing.git"));
    const result = release(fixture, "patch", "--no-verify");
    assert.notEqual(result.status, 0, "a failed push must not report a successful release");
    assert.match(result.stderr ?? "", /branch push to origin failed/);
    assert.match(result.stderr ?? "", /tag push to origin failed/);
    assert.match(result.stderr ?? "", /publication incomplete/);

    // Best effort: the mirror is still attempted after origin fails, and the
    // local release survives either way.
    const head = git(fixture.root, "rev-parse", "HEAD").trim();
    assert.equal(tagCommit(fixture.base, fixture.github, "v1.2.4"), head);
    assert.equal(git(fixture.root, "rev-parse", "--verify", "refs/tags/v1.2.4^{}").trim(), head);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
