// What the game downloads before you can drive, built as it's shipped. It builds the game into a
// folder of its own, serves it, opens it as a player does (it opens driving round the city, once the
// loading screen goes) and adds up every file the page fetched: as it is, and gzipped. GitHub Pages
// compresses a little less: 1.47 MB live on 2026-10-14, when this said 1.41. For the budget (task
// 004 in braga-map): a phone on 4G waits for all of it before it can drive.
//
// node scripts/download.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'party-kart-download-'));

await build({ root: ROOT, logLevel: 'error', build: { outDir: OUT, emptyOutDir: true } });
const server = await preview({ root: ROOT, logLevel: 'error', preview: { port: 0 }, build: { outDir: OUT } });
const url = server.resolvedUrls.local[0];
const origin = new URL(url).origin;
const browser = await chromium.launch({ args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
const files = [];
try {
  const page = await browser.newPage();
  // Each response's body is read as it comes, and all of them before adding up.
  const reading = [];
  page.on('response', (r) => {
    if (new URL(r.url()).origin !== origin) return;
    reading.push(
      r
        .body()
        .catch(() => null)
        .then((body) => body && files.push({ name: new URL(r.url()).pathname.split('/').pop() || 'index.html', raw: body.length, gz: zlib.gzipSync(body).length })),
    );
  });
  const started = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 120_000 });
  console.log(`Driving ${((Date.now() - started) / 1000).toFixed(1)} s after opening, on this computer, from a server on it.\n`);
  await Promise.all(reading);
} finally {
  await browser.close();
  await server.close();
  fs.rmSync(OUT, { recursive: true, force: true });
}

// A tile of the map is a chunk named after its place, x<column>z<row>.
const kinds = [
  ['the page', (f) => !f.name.endsWith('.js')],
  ['the game (three.js, PeerJS, the code)', (f) => /^index-.*\.js$/.test(f.name)],
  ['the map tiles', (f) => /^x-?\d+z-?\d+-.*\.js$/.test(f.name)],
  ['the rest', () => true],
];
const MB = (b) => `${(b / 1048576).toFixed(2)} MB`.padStart(9);
const left = [...files];
console.log(`${''.padEnd(40)} ${'files'.padStart(5)} ${'as is'.padStart(9)} ${'gzipped'.padStart(9)}`);
for (const [what, test] of kinds) {
  const these = left.filter(test);
  for (const f of these) left.splice(left.indexOf(f), 1);
  if (!these.length) continue;
  const sum = (k) => these.reduce((n, f) => n + f[k], 0);
  console.log(`${what.padEnd(40)} ${String(these.length).padStart(5)} ${MB(sum('raw'))} ${MB(sum('gz'))}`);
}
const total = (k) => files.reduce((n, f) => n + f[k], 0);
console.log(`${'In all'.padEnd(40)} ${String(files.length).padStart(5)} ${MB(total('raw'))} ${MB(total('gz'))}`);
