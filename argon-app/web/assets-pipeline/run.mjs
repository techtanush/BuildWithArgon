// OWNER: karthik. JS-only launcher for environments where esbuild subprocesses cannot run.
import ts from "typescript";
import fs from "node:fs/promises";
import path from "node:path";
const name = process.argv[2] || "build";
if (!["build", "fetch"].includes(name)) throw Error("Expected build or fetch");
const source = await fs.readFile(
  path.join(import.meta.dirname, `${name}.ts`),
  "utf8",
);
const js = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replaceAll("'./lib/lock'", "'./lib/lock.ts'")
  .replaceAll(
    "'../src/world/kit/props.contract'",
    "'../src/world/kit/props.contract.ts'",
  );
const resolvedJs = js
  .replaceAll('"./lib/lock"', '"./lib/lock.ts"')
  .replaceAll(
    '"../src/world/kit/props.contract"',
    '"../src/world/kit/props.contract.ts"',
  );
const dest = path.join(import.meta.dirname, `.${name}.runtime.mjs`);
await fs.writeFile(dest, resolvedJs);
try {
  process.argv[1] = dest;
  await import(dest);
} finally {
  await fs.rm(dest, { force: true });
}
