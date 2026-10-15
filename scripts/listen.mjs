// Records the race's sound, to judge a change to it by ear, as shots.mjs does the look. Each take
// is 60 s of what the game plays (?autodrive&record=60), from the countdown, with the autopilot
// driving:
//
// - race: eight karts from the grid, with items, so they fly round you;
// - alone: your kart alone, no items, from the start of the lap's fastest minute (sample 2535);
// - cobbles: alone, onto the cobbles that start at sample 7137, for the tyres' rumble;
// - liberdade, ponte, picoto: 30 s alone onto the Avenida da Liberdade, past São João da Ponte and
//   the Rio Este, and by the Picoto, for the city round the track.
//
// The takes go in sounds/<round>/<take>.webm, and what the game measured of them in
// sounds/<round>/sound.json: its loudest sample and how many clipped, which effects played, and
// the same for the loudest sounds played at once. sounds/<round>/index.html sets each take beside
// the baseline's (the latest round labelled baseline) and the round before's, with how loud each
// file is and how far its loudest moment stands out. A round is named after the day and a label.
// It starts its own dev server. A race needs a room, and a room PeerJS's public server, so it needs
// internet access. About 6 minutes, in which nothing is heard: the browser is muted, which the
// recording isn't.
//
// node scripts/listen.mjs baseline           both takes, into sounds/<today>-baseline/
// node scripts/listen.mjs mix race           only the takes named
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '..');
const SECONDS = 60;
const TAKES = {
  race: { name: 'Eight karts from the grid, with items', bots: 7, items: true, at: 0 },
  alone: { name: 'Alone at speed, no items', bots: 0, items: false, at: 2535 },
  cobbles: { name: 'Alone onto the cobbles', bots: 0, items: false, at: 7050 },
  liberdade: { name: 'The Avenida da Liberdade', bots: 0, items: false, at: 640, seconds: 30 },
  ponte: { name: 'São João da Ponte and the Rio Este', bots: 0, items: false, at: 990, seconds: 30 },
  picoto: { name: 'By the Picoto', bots: 0, items: false, at: 5480, seconds: 30 },
};

const [label, ...only] = process.argv.slice(2);
if (!label || !/^[\w-]+$/.test(label) || only.some((t) => !TAKES[t])) {
  console.error(`node scripts/listen.mjs <label> [${Object.keys(TAKES).join('|')}…]   the label in letters, numbers and dashes`);
  process.exit(1);
}
const takes = Object.keys(TAKES).filter((t) => !only.length || only.includes(t));
const day = new Date();
const round = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}-${label}`;
const DIR = path.join(ROOT, 'sounds');
const OUT = path.join(DIR, round);
fs.mkdirSync(OUT, { recursive: true });

const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

// How loud a recording is, decoded in the browser: its peak and its loudness (RMS) over the take,
// and over each 400 ms of it, the loudest moment and the typical one (the median). The loudest
// standing far above the typical is a sound jumping out of the mix.
async function hearFile(page, file) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(bytes.buffer);
    const W = Math.round(buf.sampleRate * 0.4);
    const chans = [...Array(buf.numberOfChannels).keys()].map((k) => buf.getChannelData(k));
    let peak = 0;
    let sum = 0;
    const windows = [];
    for (let i = 0; i + W <= buf.length; i += W) {
      let w = 0;
      for (const d of chans) {
        for (let j = i; j < i + W; j++) {
          peak = Math.max(peak, Math.abs(d[j]));
          w += d[j] * d[j];
        }
      }
      sum += w;
      windows.push(Math.sqrt(w / (W * chans.length)));
    }
    const db = (x) => +(20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
    const sorted = [...windows].sort((a, b) => a - b);
    return {
      seconds: +buf.duration.toFixed(1),
      peakDb: db(peak),
      rmsDb: db(Math.sqrt(sum / (windows.length * W * chans.length))),
      loudestDb: db(sorted[sorted.length - 1]),
      typicalDb: db(sorted[Math.floor(sorted.length / 2)]),
    };
  }, fs.readFileSync(file).toString('base64'));
}

// A dev server of our own on a free port, as shots.mjs has, for the same reason; not watching the
// takes it writes.
const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0, watch: { ignored: [path.join(DIR, '**')] } } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const sound = {
  round,
  made: new Date().toISOString(),
  game: git('rev-parse --short HEAD') + (git('status --porcelain') ? ' with changes' : ''),
  map: JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'braga-map', 'package.json'), 'utf8')).version,
  seconds: SECONDS,
  takes: {},
};
const failed = [];
let html = '';
try {
  for (const id of takes) {
    const take = TAKES[id];
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      const seconds = take.seconds ?? SECONDS;
      await page.goto(`${url}?autodrive&record=${seconds}${take.at ? `&at=${take.at}` : ''}`);
      // The game opens driving round the city: the race is the menu's "Corrida", in a room of
      // your own.
      await page.waitForFunction(() => window.__kart?.mode === 'roam', null, { timeout: 120_000 });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '🏁 Corrida' }).click();
      const bots = page.locator('label', { hasText: 'Bots' }).locator('select');
      await bots.waitFor({ timeout: 30_000 });
      await bots.selectOption(String(take.bots));
      await page.locator('label', { hasText: 'Itens' }).locator('input').setChecked(take.items);
      const saved = page.waitForEvent('download', { timeout: (seconds + 60) * 1000 });
      await page.getByRole('button', { name: 'Começar a corrida' }).click();
      const file = path.join(OUT, `${id}.webm`);
      await (await saved).saveAs(file);
      const audio = await page.evaluate(() => window.__kart?.audio);
      // The loudest the game can be, whatever the take had in it: a foguete going off in your lap
      // as you're hit, on a best lap, a honk, a wall and a turbo, all at once, over the engine.
      const stack = await page.evaluate(async () => {
        const s = window.__sound;
        s.resetMeter();
        s.sfx.boom();
        s.sfx.hit();
        s.lapSound(true);
        s.horn([523, 659]);
        s.thud(10);
        s.sfx.turbo(2);
        await new Promise((r) => setTimeout(r, 2000));
        return window.__kart.audio;
      });
      const heard = await hearFile(page, file);
      if (errors.length) throw new Error(errors.join('; '));
      sound.takes[id] = { ...take, file: `${id}.webm`, peakDb: audio?.peakDb ?? null, clipped: audio?.clipped ?? null, played: audio?.played ?? {}, city: audio?.city ?? {}, stack: { peakDb: stack.peakDb, clipped: stack.clipped } };
      const effects = Object.entries(audio?.played ?? {}).map(([k, n]) => `${n} ${k}`).join(', ');
      console.log(`${id.padEnd(6)} ${heard.seconds} s · the game's peak ${audio?.peakDb} dBFS, ${audio?.clipped} samples clipped`);
      console.log(`${''.padEnd(6)} the file: peak ${heard.peakDb} dBFS, loudness ${heard.rmsDb} dBFS RMS, its loudest 400 ms ${heard.loudestDb} and typical ${heard.typicalDb}`);
      console.log(`${''.padEnd(6)} effects: ${effects || 'none'}`);
      console.log(`${''.padEnd(6)} the city, each bed's loudest: ${Object.entries(audio?.city ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
      console.log(`${''.padEnd(6)} the loudest sounds at once: peak ${stack.peakDb} dBFS, ${stack.clipped} samples clipped`);
    } catch (e) {
      failed.push(`${id}: ${e.message.split('\n')[0]}`);
      console.log(`${id.padEnd(6)} failed: ${e.message.split('\n')[0]}`);
    }
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'sound.json'), JSON.stringify(sound, null, 2) + '\n');

  // ---- The sheet: each take, beside the baseline's and the round before's. ----

  const rounds = fs
    .readdirSync(DIR)
    .filter((d) => d !== round && fs.existsSync(path.join(DIR, d, 'sound.json')))
    .map((d) => JSON.parse(fs.readFileSync(path.join(DIR, d, 'sound.json'), 'utf8')))
    .filter((s) => s.made < sound.made)
    .sort((a, b) => (a.made < b.made ? 1 : -1));
  const beside = [rounds.find((s) => s.round.endsWith('-baseline')), rounds[0]].filter((s, k, all) => s && all.indexOf(s) === k);
  // Every file on the sheet is heard by the same measure, today's, whenever it was recorded.
  const page = await browser.newPage();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const said = (t, h) =>
    [
      `the game's peak ${t.peakDb} dBFS, ${t.clipped} clipped`,
      h && `loudness ${h.rmsDb} dBFS RMS; its loudest 400 ms ${h.loudestDb}, ${(h.loudestDb - h.typicalDb).toFixed(1)} dB over the typical`,
      t.stack && `the loudest sounds at once: ${t.stack.peakDb} dBFS, ${t.stack.clipped} clipped`,
      t.played && `<br>effects: ${Object.entries(t.played).map(([k, n]) => `${n} ${esc(k)}`).join(', ') || 'none'}`,
      t.city && Object.keys(t.city).length && `<br>the city, each bed's loudest: ${Object.entries(t.city).map(([k, v]) => `${esc(k)} ${v}`).join(', ')}`,
    ]
      .filter(Boolean)
      .join(' · ');
  const rows = [];
  for (const id of Object.keys(TAKES)) {
    const figs = [];
    for (const s of [sound, ...beside]) {
      const t = s.takes[id];
      const file = path.join(DIR, s.round, `${id}.webm`);
      const h = t && fs.existsSync(file) ? await hearFile(page, file) : null;
      const src = s === sound ? `${id}.webm` : `../${s.round}/${id}.webm`;
      figs.push(`<figure><figcaption><b>${esc(s.round)}</b> · party-kart ${esc(s.game)}</figcaption>${t ? `<audio controls preload="none" src="${esc(src)}"></audio><figcaption>${said(t, h)}</figcaption>` : '<figcaption>not recorded</figcaption>'}</figure>`);
    }
    rows.push(`<section><h2>${esc(TAKES[id].name)} <small>${id}</small></h2>${figs.join('')}</section>`);
  }
  html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sound ${esc(round)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f2; --fg: #1d1d1f; --dim: #6b6b70; --line: #d9d7d2; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141416; --fg: #ececec; --dim: #9a9aa0; --line: #2c2c30; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; max-width: 760px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  h2 { margin: 24px 0 8px; font-size: 16px; }
  small, figcaption, header p { color: var(--dim); font-weight: normal; }
  figure { margin: 0 0 12px; padding: 8px 0; border-top: 1px solid var(--line); }
  figcaption b { color: var(--fg); }
  audio { display: block; width: 100%; margin: 6px 0; }
</style>
<header>
  <h1>Sound ${esc(round)}</h1>
  <p>party-kart ${esc(sound.game)} · braga-map ${esc(sound.map)} · ${SECONDS} s a take (the places' 30 s), from the countdown${beside.length ? ` · set beside ${beside.map((s) => esc(s.round)).join(' and ')}` : ''}</p>
</header>
${rows.join('\n')}
</html>
`;
} finally {
  await browser.close();
  await server.close();
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);

console.log(`\n${takes.length - failed.length} takes: ${path.relative(ROOT, path.join(OUT, 'index.html'))}`);
if (failed.length) {
  console.log(`${failed.length} failed:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
