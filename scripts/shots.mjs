// Shoots every viewpoint in the game, to see whether the city looks more like Braga than it did.
// For each of braga-map's viewpoints (../braga-map/refs/viewpoints.json), at High and at Low (and
// Medium, with --medium), it opens the city alone (?scenery) from the viewpoint's camera and saves
// shots/<round>/<quality>/<id>.png, the shape of the viewpoint's photo and 720 pixels high. What
// each frame costs goes in shots/<round>/stats.json, and shots/<round>/index.html sets each shot
// beside the real photo (braga-map's .cache/refs/, which its tools/refs.mjs fetches) and the round
// before's. A round is named after the day and a label. It starts its own dev server, and never
// touches the network.
//
// node scripts/shots.mjs baseline                   every viewpoint, into shots/<today>-baseline/
// node scripts/shots.mjs facades estadio devesa     only the viewpoints named
// node scripts/shots.mjs budget --medium            Medium too, for the budget (task 004)
// node scripts/shots.mjs photos --photos            with the map's photo textures (?photos, its task 007)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAP = path.resolve(ROOT, '../braga-map');
const H = 720;

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const QUALITIES = flags.includes('--medium') ? ['high', 'medium', 'low'] : ['high', 'low'];
const PHOTOS = flags.includes('--photos');
const LEVEL = { high: 'High', medium: 'Medium', low: 'Low' };
const [label, ...only] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!label || !/^[\w-]+$/.test(label)) {
  console.error('node scripts/shots.mjs <label> [viewpoint ids…] [--medium] [--photos]   the label in letters, numbers and dashes');
  process.exit(1);
}
const day = new Date();
const round = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}-${label}`;
const OUT = path.join(ROOT, 'shots', round);

const views = JSON.parse(fs.readFileSync(path.join(MAP, 'refs', 'viewpoints.json'), 'utf8')).viewpoints.filter((v) => !only.length || only.includes(v.id));
const missing = only.filter((id) => !views.some((v) => v.id === id));
if (missing.length) throw new Error(`no viewpoint called ${missing.join(', ')}`);

// A JPEG's width and height, from its frame header.
function jpegSize(file) {
  const b = fs.readFileSync(file);
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

// Each shot takes its photo's shape (a phone's 4:3, a panorama's cut 16:9, a wide 20:9), so the two
// frame the same view; without the photo, 16:9.
const photoOf = (v) => path.join(MAP, '.cache', 'refs', `${v.id}.jpg`);
const sizeOf = (v) => {
  const s = fs.existsSync(photoOf(v)) ? jpegSize(photoOf(v)) : null;
  return { width: Math.round((H * (s ? s.w / s.h : 16 / 9)) / 2) * 2, height: H };
};

// A dev server of our own on a free port, never one already running: Vite doesn't watch
// node_modules, so one started before braga-map was last installed still serves the old map.
async function devServer() {
  const s = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } });
  await s.listen();
  return { url: s.resolvedUrls.local[0], close: () => s.close() };
}

const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const server = await devServer();
const origin = new URL(server.url).origin;
// The real graphics card: headless Chromium on Windows draws with a software one otherwise.
const browser = await chromium.launch({ args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
const stats = {
  round,
  made: new Date().toISOString(),
  game: git('rev-parse --short HEAD') + (git('status --porcelain') ? ' with changes' : ''),
  map: JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'braga-map', 'package.json'), 'utf8')).version,
  photos: PHOTOS,
  gpu: '',
  pixelRatio: 1,
  shots: {},
};
const failed = [];
const started = Date.now();
try {
  for (const quality of QUALITIES) {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    await context.addInitScript((q) => localStorage.setItem('pk-quality', q), quality);
    // Anything off the dev server is refused: a shot needs no network.
    await context.route('**/*', (r) => (new URL(r.request().url()).origin === origin ? r.continue() : (console.log(`  refused ${r.request().url()}`), r.abort())));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    stats.gpu ||= await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    });
    fs.mkdirSync(path.join(OUT, quality), { recursive: true });
    stats.shots[quality] = {};
    for (const v of views) {
      const size = sizeOf(v);
      try {
        errors.length = 0;
        await page.setViewportSize(size);
        await page.goto(`${server.url}?scenery${PHOTOS ? '&photos' : ''}&view=${[v.x, v.y, v.z, v.tx, v.ty, v.tz, v.fov].join(',')}`);
        // The city built and two frames drawn; then what a frame costs, over 60 of them.
        await page.waitForFunction(() => window.__kart?.frames >= 2, null, { timeout: 120_000 });
        await page.screenshot({ path: path.join(OUT, quality, `${v.id}.png`) });
        // The middle of three runs: the graphics card takes a moment to speed up.
        const runs = await page.evaluate(() => [1, 2, 3].map(() => window.__kart.timeFrames(60)));
        const k = await page.evaluate(() => window.__kart);
        if (errors.length) throw new Error(errors.join('; '));
        const frameMs = runs.sort((a, b) => a - b)[1];
        stats.shots[quality][v.id] = { ...size, buildMs: k.buildMs, calls: k.calls, tris: k.tris, textures: k.textures, texMB: k.texMB, geometries: k.geometries, frameMs: +frameMs.toFixed(2) };
        console.log(`${quality.padEnd(6)} ${v.id.padEnd(22)} ${String(k.calls).padStart(5)} calls ${(k.tris / 1e6).toFixed(2).padStart(6)} M triangles ${String(k.texMB).padStart(4)} MB textures ${frameMs.toFixed(2).padStart(6)} ms a frame`);
      } catch (e) {
        failed.push(`${quality} ${v.id}: ${e.message.split('\n')[0]}`);
        console.log(`${quality.padEnd(6)} ${v.id.padEnd(22)} failed: ${e.message.split('\n')[0]}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');

// ---- The sheet: each viewpoint's photo, this round's shot and the round before's. ----

const before = fs
  .readdirSync(path.join(ROOT, 'shots'))
  .filter((d) => d !== round && fs.existsSync(path.join(ROOT, 'shots', d, 'stats.json')))
  .map((d) => JSON.parse(fs.readFileSync(path.join(ROOT, 'shots', d, 'stats.json'), 'utf8')))
  .filter((s) => s.made < stats.made)
  .sort((a, b) => (a.made < b.made ? 1 : -1))[0];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const url = (p) => p.split(path.sep).map(encodeURIComponent).join('/');
const cost = (s) => (s ? `${s.calls} calls · ${(s.tris / 1e6).toFixed(2)} M triangles${s.texMB === undefined ? '' : ` · ${s.texMB} MB textures`} · ${s.frameMs} ms a frame` : 'not shot');
const shot = (q, s, src, what) => `<figure class="q ${q}">${s ? `<img src="${esc(src)}" alt="">` : '<div class="none"></div>'}<figcaption>${what}, ${LEVEL[q]}: ${cost(s)}</figcaption></figure>`;
const rows = views.map((v) => {
  const photo = fs.existsSync(photoOf(v))
    ? `<img src="${esc(url(path.relative(OUT, photoOf(v))))}" alt="">`
    : '<div class="none">The photo isn’t fetched: <code>node tools/refs.mjs</code> in braga-map</div>';
  const p = v.photo;
  const credit = `Photo: <a href="${esc(p.url)}">${esc(p.author)}</a>, ${esc(p.licence)}, ${esc(p.source === 'mapillary' ? 'Mapillary' : p.source)}, ${esc(p.date)}`;
  const figs = QUALITIES.flatMap((q) => [
    shot(q, stats.shots[q]?.[v.id], `${q}/${v.id}.png`, 'This round'),
    before ? shot(q, before.shots[q]?.[v.id], `../${before.round}/${q}/${v.id}.png`, `${before.round}`) : `<figure class="q ${q}"><div class="none">No round before this one</div></figure>`,
  ]);
  return `<section><h2>${esc(v.name)} <small>${esc(v.id)} · ${esc(v.kind)}</small></h2><div class="row"><figure>${photo}<figcaption>${credit}</figcaption></figure>${figs.join('')}</div></section>`;
});
const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shots ${esc(round)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f2; --fg: #1d1d1f; --dim: #6b6b70; --line: #d9d7d2; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141416; --fg: #ececec; --dim: #9a9aa0; --line: #2c2c30; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
  header { position: sticky; top: 0; background: var(--bg); padding: 8px 0 12px; border-bottom: 1px solid var(--line); z-index: 1; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  h2 { margin: 24px 0 8px; font-size: 16px; }
  small, figcaption, header p { color: var(--dim); font-weight: normal; }
  header p { margin: 0 0 8px; }
  .row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  figure { margin: 0; }
  img, .none { display: block; width: 100%; border-radius: 4px; }
  .none { aspect-ratio: 4 / 3; border: 1px dashed var(--line); display: grid; place-items: center; text-align: center; color: var(--dim); padding: 8px; box-sizing: border-box; }
  figcaption { font-size: 12px; margin-top: 4px; }
  a { color: inherit; }
${QUALITIES.map((q) => `  body:has(#q-${q}:checked) .q:not(.${q}) { display: none; }`).join('\n')}
  @media (max-width: 760px) { .row { grid-template-columns: 1fr; } }
</style>
<header>
  <h1>Shots ${esc(round)}</h1>
  <p>party-kart ${esc(stats.game)} · braga-map ${esc(stats.map)} · ${esc(stats.gpu)} · ${views.length} viewpoints${before ? ` · set beside ${esc(before.round)}` : ''}</p>
${QUALITIES.map((q, k) => `  <label><input type="radio" name="q" id="q-${q}"${k ? '' : ' checked'}> ${LEVEL[q]}</label>`).join('\n')}
</header>
${rows.join('\n')}
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);

console.log(`\n${QUALITIES.length * views.length - failed.length} shots in ${Math.round((Date.now() - started) / 1000)} s: ${path.relative(ROOT, path.join(OUT, 'index.html'))}`);
if (failed.length) {
  console.log(`${failed.length} failed:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
