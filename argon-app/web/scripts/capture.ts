// OWNER: ayan — seed version; replace/extend freely but keep the exported names.

// Headless capture + probes for worldgen (05-world/10-render-critique-loop.md §2, 05-world/13 §5).
//   pnpm capture --run <run_id> --iter <n> --source staging|generated|fallback [--only a,b] [--url http://...]
//   pnpm capture --portraits [--agents a,b] [--url ...] [--out-portraits DIR]
// Options: --out DIR (root holding captures/ and probes/; default kernel/data/worldgen/runs/<run>),
//   --modes exterior,interior  --no-video  --gpu (no swiftshader flags)  --fake (serve scripts/fixtures/fake-capture.html)
//   --fast (fake page: 1 s walk paths)  --fail P5,P6 (fake page: probes to fail)  --summary FILE (JSON summary)
// Contract with the page: window.__foundryProbe (src/world/probes/types.ts). Building failures are data:
// the exit code is non-zero only on infrastructure failure (browser or server didn't start).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  CAMERAS,
  CRITICAL_PROBES,
  WALK_PATH_SECONDS,
  type BuildingProbeReport,
  type CameraName,
  type CaptureMode,
  type CaptureSource,
  type ProbeCheck,
  type ProbeId,
  type ProbeResult,
  type WalkPath,
} from '../src/world/probes/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..');
const APP = resolve(WEB, '..');
const WORLDGEN = join(APP, 'kernel', 'data', 'worldgen');
const ROSTER = join(APP, 'kernel', 'data', 'roster.json');
const ALL_PROBES: ProbeId[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'];
const BOTH_MODES: ProbeId[] = ['P1', 'P2', 'P6', 'P7', 'P8'];
const VIEWPORT = { width: 1280, height: 720 };
const PORTRAIT_VIEWPORT = { width: 768, height: 768 };
const READY_TIMEOUT_MS = 60_000;
const FALLBACK_FRAMES = 8;

export interface CaptureArgs {
  run?: string;
  iter: string;
  source: CaptureSource;
  only: string[];
  url?: string;
  out?: string;
  modes: Exclude<CaptureMode, 'portrait'>[];
  video: boolean;
  gpu: boolean;
  fake: boolean;
  fast: boolean;
  fail: string[];
  portraits: boolean;
  agents: string[];
  outPortraits?: string;
  summary?: string;
}

export function parseArgs(argv: string[]): CaptureArgs {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const list = (name: string) => (get(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const source = (get('source') ?? 'staging') as CaptureSource;
  if (!['staging', 'generated', 'fallback'].includes(source)) throw new Error(`bad --source ${source}`);
  const modes = (list('modes').length ? list('modes') : ['exterior', 'interior']) as CaptureArgs['modes'];
  return {
    run: get('run'), iter: get('iter') ?? '0', source, only: list('only'), url: get('url'), out: get('out'), modes,
    video: !has('no-video'), gpu: has('gpu'), fake: has('fake'), fast: has('fast'), fail: list('fail'),
    portraits: has('portraits'), agents: list('agents'), outPortraits: get('out-portraits'), summary: get('summary'),
  };
}

interface Roster { departments: { id: string }[]; agents: { id: string }[] }
const roster = (): Roster => JSON.parse(readFileSync(ROSTER, 'utf8')) as Roster;

function findFfmpeg(): string | null {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  for (const root of [join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright')]) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).filter((n) => n.startsWith('ffmpeg-')).sort().reverse()) {
      for (const f of readdirSync(join(root, d))) if (f.startsWith('ffmpeg')) return join(root, d, f);
    }
  }
  return null;
}

/** The webm encoder this ffmpeg build has (Playwright's builds differ: libvpx = VP8, libvpx-vp9 = VP9). */
function webmEncoder(ffmpeg: string): string | null {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  const names = new Set((r.stdout ?? '').split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean));
  return ['libvpx-vp9', 'libvpx', 'vp8', 'vp9'].find((e) => names.has(e)) ?? null;
}

/** Trim the lead-in (page load) off a Playwright recording; keeps the original if ffmpeg is unavailable. */
function trimVideo(src: string, dest: string, startS: number, durS: number): { trimmed: boolean } {
  mkdirSync(dirname(dest), { recursive: true });
  const ffmpeg = findFfmpeg();
  const encoder = ffmpeg ? webmEncoder(ffmpeg) : null;
  if (ffmpeg && encoder) {
    const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', startS.toFixed(2), '-i', src, '-t', durS.toFixed(2),
      '-c:v', encoder, '-b:v', '1500k', '-an', dest], { encoding: 'utf8', timeout: 120_000 });
    if (r.status === 0 && existsSync(dest) && statSync(dest).size > 1000) return { trimmed: true };
  }
  renameSync(src, dest);
  return { trimmed: false };
}

// ------------------------------------------------------------------ servers

async function waitHttp(url: string, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startFakeServer(): Promise<{ url: string; server: Server }> {
  const html = readFileSync(join(HERE, 'fixtures', 'fake-capture.html'));
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, server };
}

async function startVite(): Promise<{ url: string; proc: ChildProcess }> {
  const vite = join(WEB, 'node_modules', '.bin', 'vite');
  const proc = spawn(vite, ['--port', '5199', '--strictPort'], { cwd: WEB, stdio: 'ignore', env: process.env });
  const url = 'http://localhost:5199';
  if (!(await waitHttp(url, 90_000))) {
    proc.kill();
    throw new Error('vite dev server did not start on :5199');
  }
  return { url, proc };
}

// ------------------------------------------------------------------ page helpers

async function waitReady(page: Page): Promise<{ ready: boolean; error?: string }> {
  try {
    await page.waitForFunction(() => window.__foundryProbe?.ready === true, undefined, { timeout: READY_TIMEOUT_MS });
  } catch {
    return { ready: false, error: `__foundryProbe.ready not true within ${READY_TIMEOUT_MS / 1000}s` };
  }
  const error = await page.evaluate(() => window.__foundryProbe?.error);
  return { ready: true, error: error ?? undefined };
}

export function captureUrl(base: string, q: Record<string, string>): string {
  const input = new URL(base);
  const target = new URL('/view/capture', input);
  const assetBase = input.searchParams.get('assetBase');
  if (assetBase) {
    const asset = new URL(assetBase);
    if (!['http:', 'https:'].includes(asset.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(asset.hostname)
      || asset.username || asset.password) throw new Error('assetBase must be a loopback HTTP(S) URL without credentials');
    target.searchParams.set('assetBase', asset.toString());
  }
  for (const [key, value] of Object.entries(q)) target.searchParams.set(key, value);
  return target.toString();
}

/** P9 from the PNGs: luminance std-dev > 12 and no single color > 90% of pixels (decoded in the browser). */
async function nonblank(page: Page, png: Buffer): Promise<{ pass: boolean; details: string }> {
  const b64 = png.toString('base64');
  return page.evaluate(async (data: string) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const bmp = await createImageBitmap(blob);
    const w = Math.min(320, bmp.width);
    const h = Math.min(180, bmp.height);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { pass: false, details: 'no 2d context' };
    ctx.drawImage(bmp, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const counts = new Map<number, number>();
    let sum = 0;
    let sum2 = 0;
    const n = w * h;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      sum += l;
      sum2 += l * l;
      const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    const top = Math.max(...counts.values()) / n;
    return { pass: std > 12 && top <= 0.9, details: `luminance std ${std.toFixed(1)}, top color ${(top * 100).toFixed(0)}%` };
  }, b64);
}

interface ModeCapture {
  mode: Exclude<CaptureMode, 'portrait'>;
  ready: boolean;
  error?: string;
  result?: ProbeResult;
  consoleErrors: string[];
  screenshots: Partial<Record<CameraName, string>>;
  video?: string;
  videoTrimmed?: boolean;
  videoLeadInS?: number;
  frames: string[];
}

async function captureMode(browser: Browser, base: string, dept: string, mode: ModeCapture['mode'], a: CaptureArgs,
  dir: string, root: string): Promise<ModeCapture> {
  const q: Record<string, string> = { building: dept, mode, source: a.source };
  if (a.fake && a.fast) q.fast = '1';
  if (a.fake && a.fail.length) q.fail = a.fail.join(',');
  const out: ModeCapture = { mode, ready: false, consoleErrors: [], screenshots: {}, frames: [] };
  // 1) screenshots + probes
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text().slice(0, 500)); });
  page.on('pageerror', (e) => out.consoleErrors.push(`pageerror: ${e.message}`.slice(0, 500)));
  try {
    await page.goto(captureUrl(base, q), { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
    const st = await waitReady(page);
    out.ready = st.ready;
    out.error = st.error;
    if (st.ready && !st.error) {
      out.result = (await page.evaluate(() => window.__foundryProbe?.result)) ?? undefined;
      for (const cam of CAMERAS[mode]) {
        await page.evaluate((c) => window.__foundryProbe!.setCamera(c), cam);
        const file = join(dir, `${cam}.png`);
        await page.screenshot({ path: file });
        out.screenshots[cam] = relative(root, file);
      }
    }
  } catch (e) {
    out.error = `capture failed: ${(e as Error).message}`.slice(0, 500);
  } finally {
    await ctx.close();
  }
  // 2) walkthrough video (recordVideo + playPath), 8 fallback frames sampled during the path
  if (a.video && out.ready && !out.error) {
    const path: WalkPath = mode === 'exterior' ? 'ext-orbit' : 'int-walk';
    const tmp = join(tmpdir(), `foundry-capture-${process.pid}-${dept}-${mode}`);
    rmSync(tmp, { recursive: true, force: true });
    const vctx: BrowserContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: VIEWPORT } });
    const vpage = await vctx.newPage();
    const t0 = Date.now();
    let startS = 0;
    let durS = a.fake && a.fast ? 1 : WALK_PATH_SECONDS[path];
    let walkthroughComplete = false;
    try {
      await vpage.goto(captureUrl(base, q), { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
      const st = await waitReady(vpage);
      if (st.ready && !st.error) {
        startS = (Date.now() - t0) / 1000;
        const playing = vpage.evaluate((p) => window.__foundryProbe!.playPath(p), path);
        const sampleMs = (durS * 1000) / FALLBACK_FRAMES;
        for (let i = 0; i < FALLBACK_FRAMES; i++) {
          await new Promise((r) => setTimeout(r, i === 0 ? sampleMs / 2 : sampleMs));
          const f = join(dir, 'frames', `${mode === 'exterior' ? 'ext' : 'int'}-${i}.png`);
          mkdirSync(dirname(f), { recursive: true });
          await vpage.screenshot({ path: f }).catch(() => undefined);
          if (existsSync(f)) out.frames.push(relative(root, f));
        }
        await playing;
        walkthroughComplete = true;
        durS = Math.max(durS, (Date.now() - t0) / 1000 - startS);
      } else {
        out.consoleErrors.push(`video: ${st.error ?? "page never became ready"}`);
      }
    } catch (e) {
      out.consoleErrors.push(`video: ${(e as Error).message}`.slice(0, 300));
    } finally {
      const video = vpage.video();
      await vctx.close();
      const raw = video ? await video.path().catch(() => null) : null;
      if (walkthroughComplete && raw && existsSync(raw)) {
        const dest = join(dir, `${mode === 'exterior' ? 'ext' : 'int'}.webm`);
        out.videoTrimmed = trimVideo(raw, dest, startS, durS).trimmed;
        out.videoLeadInS = out.videoTrimmed ? 0 : Math.round(startS * 10) / 10;
        out.video = relative(root, dest);
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return out;
}

/** Merge both modes + P9 into a BuildingProbeReport (types.ts): P1/P2/P6/P7/P8 pass only if both pass. */
export function mergeReport(dept: string, source: CaptureSource, caps: ModeCapture[], p9: ProbeCheck): BuildingProbeReport {
  const byMode = new Map(caps.map((c) => [c.mode, c]));
  const probeIn = (c: ModeCapture | undefined, id: ProbeId): ProbeCheck | undefined => c?.result?.probes.find((p) => p.id === id);
  const fail = (id: ProbeId, details: string): ProbeCheck => ({ id, pass: false, details });
  const modeProblem = (c: ModeCapture | undefined, mode: string): string | null => {
    if (!c) return `${mode} not captured`;
    if (!c.ready) return `${mode}: ${c.error ?? 'page never became ready'}`;
    if (c.error) return `${mode}: ${c.error}`;
    if (!c.result) return `${mode}: page reported no probe result`;
    return null;
  };
  const probes: ProbeCheck[] = [];
  for (const id of ALL_PROBES) {
    if (id === 'P9') { probes.push(p9); continue; }
    const modes: ('exterior' | 'interior')[] = BOTH_MODES.includes(id) ? ['exterior', 'interior'] : id === 'P3' || id === 'P10' ? ['exterior'] : ['interior'];
    const parts: ProbeCheck[] = [];
    for (const m of modes) {
      const c = byMode.get(m);
      const problem = modeProblem(c, m);
      if (problem) { parts.push(fail(id, problem)); continue; }
      const p = probeIn(c, id);
      parts.push(p ? { ...p, details: modes.length > 1 && !p.pass ? `${m}: ${p.details}` : p.details } : fail(id, `${m}: probe not reported`));
    }
    if (id === 'P1') {
      for (const m of modes) {
        const errs = byMode.get(m)?.consoleErrors ?? [];
        if (errs.length) parts.push(fail('P1', `${m}: ${errs.length} console error(s): ${errs.slice(0, 3).join(' | ')}`));
      }
    }
    const failed = parts.filter((p) => !p.pass);
    probes.push(failed.length ? { id, pass: false, details: failed.map((p) => p.details).join('; ') } : { id, pass: true, details: parts.map((p) => p.details).filter(Boolean).join('; ') });
  }
  const passed = probes.filter((p) => p.pass).length;
  const screenshots: BuildingProbeReport['screenshots'] = {};
  const videos: BuildingProbeReport['videos'] = {};
  for (const c of caps) {
    Object.assign(screenshots, c.screenshots);
    if (c.video) videos[c.mode === 'exterior' ? 'ext' : 'int'] = c.video;
  }
  return {
    building: dept, source, probes, probe_score: Math.round((passed / ALL_PROBES.length) * 1000) / 1000,
    critical_pass: CRITICAL_PROBES.every((id) => probes.find((p) => p.id === id)?.pass === true),
    screenshots, videos,
    stats: { exterior: byMode.get('exterior')?.result?.stats, interior: byMode.get('interior')?.result?.stats },
    consoleErrors: caps.flatMap((c) => c.consoleErrors),
  };
}

function iterLabel(iter: string): string {
  return /^\d+$/.test(iter) ? `iter-${iter}` : iter;
}

async function captureBuildings(browser: Browser, base: string, a: CaptureArgs): Promise<Record<string, unknown>> {
  if (!a.out && !a.run) throw new Error('--run or --out is required');
  const root = resolve(a.out ?? join(WORLDGEN, 'runs', a.run as string));
  const depts = a.only.length ? a.only : roster().departments.map((d) => d.id);
  const summary: Record<string, unknown> = {};
  const scratch = await browser.newContext();
  const p9page = await scratch.newPage();
  for (const dept of depts) {
    const dir = join(root, 'captures', iterLabel(a.iter), dept);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const caps: ModeCapture[] = [];
    for (const mode of a.modes) caps.push(await captureMode(browser, base, dept, mode, a, dir, root));
    const checks: string[] = [];
    let p9ok = true;
    let shots = 0;
    for (const c of caps) {
      for (const rel of Object.values(c.screenshots)) {
        if (!rel) continue;
        shots += 1;
        const r = await nonblank(p9page, readFileSync(join(root, rel)));
        if (!r.pass) p9ok = false;
        checks.push(`${rel.split('/').pop()}: ${r.details}`);
      }
    }
    const p9: ProbeCheck = shots === 0 ? { id: 'P9', pass: false, details: 'no screenshots captured' }
      : { id: 'P9', pass: p9ok, details: p9ok ? `${shots} screenshots non-blank` : checks.join('; ') };
    const report = mergeReport(dept, a.source, caps, p9);
    const extra = {
      frames: caps.flatMap((c) => c.frames), video_trimmed: caps.every((c) => c.videoTrimmed !== false),
      video_lead_in_s: Object.fromEntries(caps.filter((c) => c.video).map((c) => [c.mode === 'exterior' ? 'ext' : 'int', c.videoLeadInS ?? 0])),
      root,
      provenance: { drill: a.fake, capture: a.fake ? 'fake' : 'real' },
    };
    const probeFile = join(root, 'probes', iterLabel(a.iter), `${dept}.json`);
    mkdirSync(dirname(probeFile), { recursive: true });
    writeFileSync(probeFile, `${JSON.stringify({ ...report, ...extra }, null, 2)}\n`);
    summary[dept] = { probe_score: report.probe_score, critical_pass: report.critical_pass, report: relative(root, probeFile) };
    console.log(`[capture] ${dept} probe_score=${report.probe_score} critical=${report.critical_pass} failed=${report.probes.filter((p) => !p.pass).map((p) => p.id).join(',') || '-'}`);
  }
  await scratch.close();
  return summary;
}

async function capturePortraits(browser: Browser, base: string, a: CaptureArgs): Promise<Record<string, unknown>> {
  const outDir = resolve(a.outPortraits ?? join(WEB, 'public', 'generated', 'portraits'));
  mkdirSync(outDir, { recursive: true });
  const agents = a.agents.length ? a.agents : roster().agents.map((x) => x.id);
  const summary: Record<string, unknown> = {};
  for (const agent of agents) {
    const ctx = await browser.newContext({ viewport: PORTRAIT_VIEWPORT, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.goto(captureUrl(base, { mode: 'portrait', agent, ...(a.fake ? { building: 'portrait' } : {}) }), { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
      const st = await waitReady(page);
      if (!st.ready || st.error) {
        summary[agent] = { ok: false, error: st.error ?? 'not ready' };
      } else {
        await page.evaluate(() => window.__foundryProbe!.setCamera('portrait'));
        const file = join(outDir, `${agent}.png`);
        await page.screenshot({ path: file });
        summary[agent] = { ok: true, path: file };
      }
    } catch (e) {
      summary[agent] = { ok: false, error: (e as Error).message.slice(0, 300) };
    } finally {
      await ctx.close();
    }
    console.log(`[capture] portrait ${agent} ${(summary[agent] as { ok: boolean }).ok ? 'ok' : 'FAILED'}`);
  }
  return summary;
}

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  let server: Server | undefined;
  let vite: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    let base = a.url;
    if (!base && a.fake) ({ url: base, server } = await startFakeServer());
    if (!base) ({ url: base, proc: vite } = await startVite());
    browser = await chromium.launch({
      ...(process.env.CAPTURE_BROWSER_CHANNEL ? { channel: process.env.CAPTURE_BROWSER_CHANNEL } : {}),
      ...(process.env.CAPTURE_BROWSER_EXECUTABLE ? { executablePath: process.env.CAPTURE_BROWSER_EXECUTABLE } : {}),
      args: a.gpu ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const summary = a.portraits ? await capturePortraits(browser, base, a) : await captureBuildings(browser, base, a);
    if (a.summary) writeFileSync(a.summary, `${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (e) {
    console.error(`[capture] infrastructure failure: ${(e as Error).message}`);
    return 2;
  } finally {
    await browser?.close();
    server?.close();
    vite?.kill();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
