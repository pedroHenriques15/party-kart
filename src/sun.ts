// Where the sun is in Braga's sky at a given moment, for the light (render/look.ts). NOAA's solar
// calculator's equations (after Meeus' "Astronomical Algorithms"), good to a hundredth of a degree for
// centuries either side of 2000, which is far more than a shadow needs. No refraction: it lifts the sun
// by half a degree at the horizon, and the game's day ends before that.
import { v3, type V } from './math.ts';

// The Praça da República, braga-map's (0, 0).
export const BRAGA = { lat: 41.5507, lon: -8.4211 };

const RAD = Math.PI / 180;
const sin = (d: number) => Math.sin(d * RAD);
const cos = (d: number) => Math.cos(d * RAD);

// The sun's elevation over the horizon and its azimuth (from north, through east), in degrees.
export function sunAt(utcMs: number, lat = BRAGA.lat, lon = BRAGA.lon): { el: number; az: number } {
  const jc = (utcMs / 86400000 + 2440587.5 - 2451545) / 36525;
  const l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const centre = sin(m) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + sin(2 * m) * (0.019993 - 0.000101 * jc) + sin(3 * m) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const lambda = l0 + centre - 0.00569 - 0.00478 * sin(omega);
  const eps = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60 + 0.00256 * cos(omega);
  const decl = Math.asin(sin(eps) * sin(lambda)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  // The equation of time, in minutes: how far the sun runs ahead of the clock's mean sun.
  const eot = (4 / RAD) * (y * sin(2 * l0) - 2 * e * sin(m) + 4 * e * y * sin(m) * cos(2 * l0) - 0.5 * y * y * sin(4 * l0) - 1.25 * e * e * sin(2 * m));
  const minutes = (((utcMs / 60000) % 1440) + 1440) % 1440;
  const solar = (((minutes + eot + 4 * lon) % 1440) + 1440) % 1440;
  const ha = solar / 4 - 180;
  const cz = Math.min(1, Math.max(-1, sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(ha)));
  const zenith = Math.acos(cz) / RAD;
  const ca = Math.min(1, Math.max(-1, (sin(lat) * cz - sin(decl)) / (cos(lat) * sin(zenith) || 1e-9)));
  const a = Math.acos(ca) / RAD;
  return { el: 90 - zenith, az: ha > 0 ? (a + 180) % 360 : (540 - a) % 360 };
}

// Towards the sun, in the game's axes: x east, y up, z south.
export function sunDir(utcMs: number): V {
  const { el, az } = sunAt(utcMs);
  return v3(cos(el) * sin(az), sin(el), -cos(el) * cos(az));
}

// Portugal's clock (Europe/Lisbon): UTC in winter, an hour on from the last Sunday of March to the
// last Sunday of October, each at 01:00 UTC, as the EU has it.
function lastSunday(year: number, month: number): number {
  const end = new Date(Date.UTC(year, month + 1, 0, 1));
  return end.getTime() - end.getUTCDay() * 86400000;
}
export function inSummer(utcMs: number): boolean {
  const year = new Date(utcMs).getUTCFullYear();
  return utcMs >= lastSunday(year, 2) && utcMs < lastSunday(year, 9);
}

// A time as `?time=` takes it, Braga's clock unless it says its zone: 2026-10-13T17:30, or a date alone
// for noon. Null when it isn't one.
export function braga(time: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(time.trim());
  if (!m) return null;
  const [, y, mo, d, h = '12', mi = '0', s = '0', zone] = m;
  // Not a day or a time that exists (the 31st of April, 25:00): Date.UTC would roll it on into the next.
  const check = new Date(Date.UTC(+y, +mo - 1, +d));
  if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || +h > 23 || +mi > 59 || +s > 59) return null;
  if (zone) {
    const t = Date.parse(`${y}-${mo}-${d}T${h.padStart(2, '0')}:${mi}:${s.padStart(2, '0')}${zone.length === 5 ? zone.slice(0, 3) + ':' + zone.slice(3) : zone}`);
    return Number.isNaN(t) ? null : t;
  }
  const local = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (Number.isNaN(local)) return null;
  return inSummer(local - 3600000) ? local - 3600000 : local;
}
