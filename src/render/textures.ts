// Every texture is drawn here on a canvas: nothing to download.
import * as THREE from 'three';

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, light = false): void {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * 255);
    g.fillStyle = light ? `rgba(255,255,255,${Math.random() * alpha})` : `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

// u runs across the road (0 left edge, 1 right), v along it.
export const asphalt = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#3b3f47';
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 9000, 0.12);
    g.fillStyle = '#f2f2f2';
    g.fillRect(6, 0, 6, 256);
    g.fillRect(244, 0, 6, 256);
    g.fillStyle = '#d6b14a';
    g.fillRect(126, 0, 4, 120);
  });

// Calçada portuguesa: small white limestone setts with a dark wave.
export const cobble = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#b8b2a6';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 10) {
      for (let x = (y / 10) % 2 ? 5 : 0; x < 256; x += 10) {
        const wave = Math.sin((x / 256) * Math.PI * 4 + (y / 256) * Math.PI * 2) > 0.55;
        const l = wave ? 40 + Math.random() * 20 : 215 + Math.random() * 30;
        g.fillStyle = `rgb(${l},${l},${l - 6})`;
        g.beginPath();
        g.roundRect(x + 1, y + 1, 8, 8, 2);
        g.fill();
      }
    }
  });

export const grass = () =>
  canvas(256, 256, (g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#3f9b45' : '#4aab50';
      g.fillRect(0, i * 32, 256, 32);
    }
    noise(g, 256, 256, 4000, 0.06);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(4, 0, 4, 256);
    g.fillRect(248, 0, 4, 256);
  });

export const ground = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#7b8f55';
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 12000, 0.08);
  });

export const rock = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#8a7f72';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 60; i++) {
      const l = 100 + Math.random() * 60;
      g.fillStyle = `rgba(${l},${l - 8},${l - 18},0.6)`;
      g.beginPath();
      g.moveTo(Math.random() * 256, Math.random() * 256);
      for (let k = 0; k < 4; k++) g.lineTo(Math.random() * 256, Math.random() * 256);
      g.fill();
    }
    noise(g, 256, 256, 8000, 0.1);
  });

// The barriers: white, gold trim, the party's name.
export const banner = () =>
  canvas(512, 64, (g) => {
    g.fillStyle = '#fbfbf8';
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#d4af37';
    g.fillRect(0, 0, 512, 7);
    g.fillRect(0, 57, 512, 7);
    g.fillStyle = '#1b1b1f';
    g.font = '800 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('WHITE PARTY  ✦  BRAGA GP', 256, 33);
  });

export const boost = () =>
  canvas(128, 128, (g) => {
    g.fillStyle = '#ff7a1a';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffe14d';
    for (const y of [0, 64]) {
      g.beginPath();
      g.moveTo(10, y + 56);
      g.lineTo(64, y + 10);
      g.lineTo(118, y + 56);
      g.lineTo(98, y + 56);
      g.lineTo(64, y + 30);
      g.lineTo(30, y + 56);
      g.fill();
    }
  });

export const checker = () =>
  canvas(128, 32, (g) => {
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 4; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
        g.fillRect(x * 8, y * 8, 8, 8);
      }
    }
  });

// A sign: big text on a colour, with an optional line under it.
export function sign(text: string, sub = '', bg = '#111318', fg = '#ffffff', w = 1024, h = 192): THREE.CanvasTexture {
  return canvas(
    w,
    h,
    (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d4af37';
      g.lineWidth = 10;
      g.strokeRect(5, 5, w - 10, h - 10);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = sub ? h * 0.42 : h * 0.55;
      g.font = `900 ${size}px system-ui, sans-serif`;
      while (g.measureText(text).width > w * 0.92) {
        size -= 4;
        g.font = `900 ${size}px system-ui, sans-serif`;
      }
      g.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
      if (sub) {
        g.font = `600 ${h * 0.2}px system-ui, sans-serif`;
        g.fillStyle = '#d4af37';
        g.fillText(sub, w / 2, h * 0.76);
      }
    },
    false,
  );
}

// A house front: plaster, windows in rows, a door.
export function facade(color: string, floors: number): THREE.CanvasTexture {
  return canvas(
    128,
    64 * floors,
    (g) => {
      g.fillStyle = color;
      g.fillRect(0, 0, 128, 64 * floors);
      noise(g, 128, 64 * floors, 600, 0.05);
      for (let f = 0; f < floors; f++) {
        for (const x of [14, 54, 94]) {
          const y = f * 64 + 14;
          g.fillStyle = '#f5f1e8';
          g.fillRect(x - 3, y - 3, 26, 40);
          g.fillStyle = f === floors - 1 && x === 54 ? '#5a3a22' : '#2d3b4f';
          g.fillRect(x, y, 20, 34);
          if (f < floors - 1) {
            g.fillStyle = '#333';
            g.fillRect(x - 4, y + 34, 28, 3);
          }
        }
      }
    },
    false,
  );
}

// A name above someone's car.
export function nameTag(text: string, color: string): THREE.CanvasTexture {
  return canvas(
    256,
    64,
    (g) => {
      g.font = '700 30px system-ui, sans-serif';
      const w = Math.min(244, g.measureText(text).width + 28);
      g.fillStyle = 'rgba(10,12,18,0.75)';
      g.beginPath();
      g.roundRect(128 - w / 2, 8, w, 46, 14);
      g.fill();
      g.fillStyle = color;
      g.fillRect(128 - w / 2 + 10, 20, 5, 22);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 132, 32, 220);
    },
    false,
  );
}
