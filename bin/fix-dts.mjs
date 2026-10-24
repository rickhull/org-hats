// Rewrite `.ts` import specifiers in emitted declaration files to `.js`.
//
// `tsc` rewrites relative `.ts` extensions in emitted JavaScript
// (`rewriteRelativeImportExtensions`), but declaration emit preserves the
// source specifier. A consumer with `skipLibCheck: false` would then try to
// resolve `./types.ts` inside `dist/` and fail. Run after `tsc` in `build`.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

const declarations = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await declarations(path)));
    else if (entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
};

const rewrite = (text) =>
  text
    .replace(/(from\s+["'])(\.[^"']+)\.ts(["'])/g, "$1$2.js$3")
    .replace(/(import\(\s*["'])(\.[^"']+)\.ts(["']\s*\))/g, "$1$2.js$3");

let changed = 0;
for (const file of await declarations(dist)) {
  const before = await readFile(file, "utf8");
  const after = rewrite(before);
  if (after !== before) {
    await writeFile(file, after);
    changed += 1;
  }
}
console.log(`fix-dts: rewrote ${changed} declaration file(s)`);
