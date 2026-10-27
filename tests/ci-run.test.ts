import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "org-hats-ci-"));
  for (const directory of ["ci", "bin", "tools"]) mkdirSync(join(root, directory));
  copyFileSync(join(projectRoot, "ci", "run"), join(root, "ci", "run"));
  chmodSync(join(root, "ci", "run"), 0o755);

  writeFileSync(join(root, "tools", "git"), `#!/bin/sh
case "$*" in
  "rev-parse --is-inside-work-tree") printf '%s\\n' true ;;
  "status --porcelain") printf '%s\\n' "\${CI_TEST_DIRTY:-}" ;;
  "rev-parse --is-shallow-repository") printf '%s\\n' "\${CI_TEST_SHALLOW:-false}" ;;
  "rev-parse --short=12 HEAD") printf '%s\\n' 0123456789ab ;;
  "symbolic-ref --quiet --short HEAD") printf '%s\\n' main ;;
  *) printf 'unexpected git call: %s\\n' "$*" >&2; exit 97 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(root, "tools", "node"), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
  writeFileSync(join(root, "tools", "pnpm"), `#!/bin/sh
test -z "\${CLOUDFLARE_API_TOKEN:-}\${CLOUDFLARE_ACCOUNT_ID:-}\${WRANGLER_API_TOKEN:-}" || exit 96
printf 'pnpm %s\\n' "$*" >> "$CI_TEST_LOG"
`, { mode: 0o755 });
  for (const name of ["check-dist", "check", "check-artifact"]) {
    writeFileSync(join(root, "bin", name), `#!/bin/sh
test -z "\${CLOUDFLARE_API_TOKEN:-}\${CLOUDFLARE_ACCOUNT_ID:-}\${WRANGLER_API_TOKEN:-}" || exit 96
printf 'bin/${name} %s\\n' "$*" >> "$CI_TEST_LOG"
`, { mode: 0o755 });
  }
  return root;
}

function run(root: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const log = join(root, "commands.log");
  return {
    log,
    result: spawnSync("bash", [join(root, "ci", "run"), ...args], {
      cwd: "/",
      encoding: "utf8",
      env: {
        PATH: `${join(root, "tools")}:${process.env.PATH}`,
        CI_TEST_LOG: log,
        ...env,
      },
    }),
  };
}

test("ci/run rejects a missing or unknown mode before invoking tools", () => {
  const root = fixture();
  try {
    for (const args of [[], ["unknown"]]) {
      const { log, result } = run(root, args);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /portable\|cloudflare/);
      assert.throws(() => readFileSync(log, "utf8"), { code: "ENOENT" });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci/run requires a clean, full checkout in CI mode", () => {
  const root = fixture();
  try {
    const dirty = run(root, ["portable"], { CI: "1", CI_TEST_DIRTY: " M src/example.ts" }).result;
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /clean checkout/);

    const shallow = run(root, ["portable"], { CI: "1", CI_TEST_SHALLOW: "true" }).result;
    assert.equal(shallow.status, 1);
    assert.match(shallow.stderr, /full clone/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci/run warns but continues for a dirty local checkout", () => {
  const root = fixture();
  try {
    const { log, result } = run(root, ["portable"], { CI_TEST_DIRTY: " M src/example.ts" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /not CI evidence/);
    assert.match(readFileSync(log, "utf8"), /pnpm install --frozen-lockfile --filter org-hats/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci/run scrubs credentials and uses the portable command order", () => {
  const root = fixture();
  try {
    const { log, result } = run(root, ["portable"], {
      CI: "1",
      CLOUDFLARE_API_TOKEN: "must-not-reach-a-command",
      CLOUDFLARE_ACCOUNT_ID: "must-not-reach-a-command",
      WRANGLER_API_TOKEN: "must-not-reach-a-command",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
      "pnpm install --frozen-lockfile --filter org-hats",
      "bin/check-dist ",
      "bin/check ",
      "bin/check-artifact --no-build",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci/run uses the cloudflare command order", () => {
  const root = fixture();
  try {
    const { log, result } = run(root, ["cloudflare"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
      "pnpm install --frozen-lockfile",
      "bin/check-dist ",
      "pnpm check:cloudflare",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
