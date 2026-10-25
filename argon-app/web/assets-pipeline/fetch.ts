// OWNER: karthik
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assetRoot,
  hash,
  loadLock,
  safePath,
  type LockedFile,
} from "./lib/lock";
const exec = promisify(execFile);
const curlRequest = async (input: string, bytes: number) => {
  const scratch = path.join(assetRoot, "raw/.downloads");
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(path.join(scratch, "request-"));
  try {
    const dest = path.join(dir, "response");
    await exec("curl", [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--max-time",
      "300",
      "--max-filesize",
      String(bytes),
      "--output",
      dest,
      input,
    ]);
    return new Response(await readFile(dest));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
export async function download(
  f: LockedFile,
  root = path.join(assetRoot, "raw"),
  request?: typeof fetch,
) {
  const dest = safePath(root, f.path);
  try {
    const b = await readFile(dest);
    if (b.length === f.bytes && hash(b) === f.sha256) return "cached";
  } catch {}
  await mkdir(path.dirname(dest), { recursive: true });
  let error: unknown;
  for (let a = 0; a < 4; a++) {
    for (const url of [f.url, ...(f.mirrors ?? [])])
      try {
        const r = request
          ? await request(url, { signal: AbortSignal.timeout(300000) })
          : await curlRequest(url, f.bytes);
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length !== f.bytes || hash(b) !== f.sha256)
          throw Error("SHA256/size mismatch");
        await writeFile(dest + ".part", b);
        await rename(dest + ".part", dest);
        return "downloaded";
      } catch (e) {
        error = e;
        await rm(dest + ".part", { force: true });
      }
    if (a < 3) await new Promise((r) => setTimeout(r, 250 * 2 ** a));
  }
  throw Error(`Failed ${f.path}: ${String(error)}`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const q = [...(await loadLock()).files];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let f; (f = q.shift());) console.log(await download(f), f.path);
    }),
  );
}
