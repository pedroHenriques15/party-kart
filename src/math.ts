// Small vector maths, without three.js, so the physics runs in tests too. y is up; seen from
// above, x is east and z is south.
export interface V {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V => ({ x, y, z });
export const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const addScaled = (a: V, b: V, k: number): V => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
export const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: V) => Math.hypot(a.x, a.y, a.z);
export const dist2 = (a: V, b: V) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
export const norm = (a: V): V => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const lerp = (a: V, b: V, t: number): V => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const UP: V = { x: 0, y: 1, z: 0 };

// The angle a - b, folded into (-π, π].
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
