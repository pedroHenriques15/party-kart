// What build.mjs and course.mjs share: the projection into the game's metres, and the relief.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Metres from the Praça da República: x east, z south, at Braga's latitude.
export const LAT0 = 41.5512, LON0 = -8.4220;
export const KX = 83432, KZ = 111065;
export const P = (g) => [(g.lon - LON0) * KX, -(g.lat - LAT0) * KZ];
export const unP = (x, z) => [LAT0 - z / KZ, LON0 + x / KX];

// Enough of PNG to read the elevation tiles: 8-bit RGB or RGBA, not interlaced.
function decodePNG(buf) {
  let off = 8, w, h, ct;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride), prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

// Height above the sea at (x, z), from the Terrain Tiles fetch.mjs downloaded (zoom 14, Terrarium
// encoding), interpolated between pixels.
export function relief(demDir) {
  const Z = 14, tiles = new Map();
  const tile = (tx, ty) => {
    const k = tx + '_' + ty;
    if (!tiles.has(k)) tiles.set(k, decodePNG(fs.readFileSync(path.join(demDir, `${Z}_${k}.png`))));
    return tiles.get(k);
  };
  const px = (gx, gy) => {
    const t = tile(Math.floor(gx / 256), Math.floor(gy / 256)), i = ((gy % 256) * 256 + (gx % 256)) * t.bpp;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  return (x, z) => {
    const [lat, lon] = unP(x, z), n = 2 ** Z * 256, r = (lat * Math.PI) / 180;
    const X = ((lon + 180) / 360) * n - 0.5, Y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n - 0.5;
    const x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
    return (px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx) * (1 - fy) + (px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx) * fy;
  };
}
