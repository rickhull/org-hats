// The deployable-artifact gate: tag/config validation and the bundle check's
// failure branches. The bundle build itself is exercised by `bin/release` and
// an operator run; these cases stay offline and fast.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../bin/check-deploy", import.meta.url));

const testEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const configFor = (overrides: Record<string, unknown> = {}): string => {
  const config = {
    name: "reporting-stream-authority",
    main: "src/index.ts",
    compatibility_date: "2026-10-24",
    workers_dev: false,
    ...overrides,
  };
  return `// test configuration\n${JSON.stringify(config, null, 2)}\n`;
};

const repo = ({
  version = "0.3.2",
  config = configFor(),
}: {
  version?: string;
  config?: string;
} = {}): string => {
  const root = mkdtempSync(join(tmpdir(), "org-hats-deploy-"));
  mkdirSync(join(root, "packages", "cloudflare", "src"), { recursive: true });
  writeFileSync(
    join(root, "packages", "cloudflare", "package.json"),
    `${JSON.stringify({ name: "cloudflare", version }, null, 2)}\n`,
  );
  writeFileSync(join(root, "packages", "cloudflare", "wrangler.production.jsonc"), config);
  writeFileSync(join(root, "packages", "cloudflare", "src", "index.ts"), "export default {};\n");
  return root;
};

const run = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [script, "--root", root, "--no-build", ...args], {
    encoding: "utf8",
    env: testEnv,
  });

const git = (root: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c", "user.name=Deploy Test",
      "-c", "user.email=deploy@example.test",
      "-c", "commit.gpgsign=false",
      "-c", "tag.gpgsign=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8", env: testEnv },
  );

test("a working tree with the production shape passes", () => {
  const root = repo();
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /working tree \(version 0\.3\.2\)/);
    assert.match(result.stdout, /workers_dev false/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, config, expected] of [
  ["a wrong Worker name", configFor({ name: "other-worker" }), /names "other-worker"/],
  ["workers_dev true", configFor({ workers_dev: true }), /must set workers_dev false/],
  ["routes", configFor({ routes: [{ pattern: "example.com/*" }] }), /must not declare routes/],
  ["a missing main module", configFor({ main: "src/missing.ts" }), /missing packages\/cloudflare\/src\/missing\.ts/],
] as const) {
  test(`${label} is refused`, () => {
    const root = repo({ config });
    try {
      const result = run(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("a matching annotated tag passes; a mismatched one is refused", () => {
  const root = repo();
  try {
    git(root, "init", "-q");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "fixture");
    git(root, "tag", "-a", "cloudflare-v0.3.2", "-m", "cloudflare-v0.3.2");

    const good = run(root, "cloudflare-v0.3.2");
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /cloudflare-v0\.3\.2 -> /);

    git(root, "tag", "-a", "cloudflare-v0.1.0", "-m", "cloudflare-v0.1.0");
    const bad = run(root, "cloudflare-v0.1.0");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /does not match .* version 0\.3\.2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lightweight tag is refused", () => {
  const root = repo();
  try {
    git(root, "init", "-q");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "fixture");
    git(root, "tag", "cloudflare-v0.3.2");

    const result = run(root, "cloudflare-v0.3.2");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not an annotated tag/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
