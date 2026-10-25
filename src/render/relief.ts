// A facade's drawing in relief (braga-map's task 123), on Ultra: how far each pixel of a bay stands out
// of its wall or into it, in metres, and the normals the walls' shader tilts its light by from that (a
// window's reveal, a sill, a stone frame, a shutter's slats). Plain arithmetic, without three.js or a
// canvas, so the tests can check it.

// Heights n × n, row 0 at the top as a canvas has it: a box x0..x0 + w across and y0..y0 + h down, in
// pixels, `depth` metres out of the wall (into it, negative), over what was there; the pixels whose
// middles are in it.
export function fillBox(z: Float32Array, n: number, x0: number, y0: number, w: number, h: number, depth: number): void {
  const i0 = Math.max(0, Math.ceil(x0 - 0.5));
  const i1 = Math.min(n - 1, Math.floor(x0 + w - 0.5));
  const j0 = Math.max(0, Math.ceil(y0 - 0.5));
  const j1 = Math.min(n - 1, Math.floor(y0 + h - 0.5));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) z[j * n + i] = depth;
}

// The upper half of an ellipse round (cx, cy), rx across and ry up, in pixels (an arch's head).
export function fillHalfDisc(z: Float32Array, n: number, cx: number, cy: number, rx: number, ry: number, depth: number): void {
  for (let j = Math.max(0, Math.floor(cy - ry)); j <= Math.min(n - 1, Math.floor(cy)); j++) {
    for (let i = Math.max(0, Math.floor(cx - rx)); i <= Math.min(n - 1, Math.ceil(cx + rx)); i++) {
      const a = (i + 0.5 - cx) / rx;
      const b = (j + 0.5 - cy) / ry;
      if (b <= 0 && a * a + b * b <= 1) z[j * n + i] = depth;
    }
  }
}

// The normals of heights n × n (row 0 at the top), its pixels sx metres across and sy up, each edge
// softened over `soft` metres (a sharp step's bevel, so its light reads past a pixel), wrapping round as
// a bay tiles: RGBA, row 0 the bottom (as a texture's v runs up), each normal (along the wall, up it, out
// of it) at 0.5 + 0.5 × its value; its alpha `glass` (laid out as z, 1 where a pane is), or 1.
export function normalsOf(z: Float32Array, n: number, sx: number, sy: number, soft = 0.015, glass?: Float32Array): Uint8Array {
  const blur = (src: Float32Array, r: number, along: boolean) => {
    const out = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += along ? src[j * n + ((i + d + n) % n)] : src[((j + d + n) % n) * n + i];
        out[j * n + i] = s / (2 * r + 1);
      }
    }
    return out;
  };
  const a = blur(blur(z, Math.max(1, Math.round(soft / sx)), true), Math.max(1, Math.round(soft / sy)), false);
  const at = (j: number, i: number) => a[((j + n) % n) * n + ((i + n) % n)];
  const out = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // Rising along the wall, and up it (a canvas's rows run down).
      const gx = (at(j, i + 1) - at(j, i - 1)) / (2 * sx);
      const gy = (at(j - 1, i) - at(j + 1, i)) / (2 * sy);
      const k = 1 / Math.hypot(gx, gy, 1);
      const d = ((n - 1 - j) * n + i) * 4;
      out[d] = Math.round((0.5 - 0.5 * gx * k) * 255);
      out[d + 1] = Math.round((0.5 - 0.5 * gy * k) * 255);
      out[d + 2] = Math.round((0.5 + 0.5 * k) * 255);
      out[d + 3] = glass ? Math.round(glass[j * n + i] * 255) : 255;
    }
  }
  return out;
}
