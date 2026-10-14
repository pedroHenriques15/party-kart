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

// u runs across the road (0 left edge, 1 right), v along it. The lines are painted on it
// separately, as the street has them.
export const asphalt = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#44464b';
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 9000, 0.12);
    // Patches and repairs, a little darker.
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(30,31,34,0.18)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 60, 10 + Math.random() * 40);
    }
  });

// Granite setts, the paralelos of Braga's older streets, in rows across the road; 2 m a tile.
export const setts = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#5d5b57';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      for (let x = (y / 16) % 2 ? -10 : 0; x < 256; x += 21) {
        const l = 92 + Math.random() * 40;
        g.fillStyle = `rgb(${l},${l - 2},${l - 6})`;
        g.beginPath();
        g.roundRect(x + 1.5, y + 1.5, 18 + Math.random() * 2, 13, 3);
        g.fill();
      }
    }
    noise(g, 256, 256, 5000, 0.1);
  });

// The pavements' calçada: small limestone setts, white and pale grey, set close; 2.5 m a tile.
export const calcada = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#9e9a92';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 8) {
      for (let x = (y / 8) % 2 ? 4 : 0; x < 256; x += 8) {
        const l = 196 + Math.random() * 44;
        g.fillStyle = `rgb(${l},${l - 2},${l - 7})`;
        g.beginPath();
        g.roundRect(x + 0.8 + Math.random() * 0.6, y + 0.8 + Math.random() * 0.6, 6.4, 6.4, 1.6);
        g.fill();
      }
    }
  });

// Granite: the kerbstones, and the bridges' parapets.
export const granite = () =>
  canvas(128, 128, (g) => {
    g.fillStyle = '#a7a39b';
    g.fillRect(0, 0, 128, 128);
    noise(g, 128, 128, 5000, 0.18);
    noise(g, 128, 128, 1500, 0.25, true);
    g.fillStyle = 'rgba(60,58,54,0.5)';
    g.fillRect(0, 0, 2, 128);
  });

// A painted line along the road, dashed: 3 m of white, then 4 m of road (v runs 7 m a tile).
export const dash = () =>
  canvas(16, 112, (g) => {
    g.fillStyle = 'rgba(240,240,232,0.95)';
    g.fillRect(0, 0, 16, 48);
  });

// A zebra crossing's bars: u across the road a metre a tile, half of it white.
export const zebra = () =>
  canvas(64, 16, (g) => {
    g.fillStyle = 'rgba(242,242,236,0.95)';
    g.fillRect(0, 0, 32, 16);
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

// The barriers at the start: white with blue bands, as Braga's street plates are, and the race's name.
// A road-works barrier's board: red and white stripes on the slant, as Portugal's are.
export const roadworks = () =>
  canvas(256, 32, (g) => {
    g.fillStyle = '#f4f2ee';
    g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#d0202a';
    for (let x = -32; x < 256; x += 64) {
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x + 32, 0);
      g.lineTo(x + 64, 0);
      g.lineTo(x + 32, 32);
      g.closePath();
      g.fill();
    }
  });

export const banner = () =>
  canvas(512, 64, (g) => {
    g.fillStyle = '#fbfbf8';
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#1d4f9c';
    g.fillRect(0, 0, 512, 7);
    g.fillRect(0, 57, 512, 7);
    g.font = '800 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('VOLTA DOS AMIGOS  ·  BRAGA', 256, 33);
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

// A sign: big text on a colour, with an optional line under it, in a frame unless `frame` is ''.
export function sign(text: string, sub = '', bg = '#111318', fg = '#ffffff', w = 1024, h = 192, frame = '#9aa0a6'): THREE.CanvasTexture {
  return canvas(
    w,
    h,
    (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      if (frame) {
        g.strokeStyle = frame;
        g.lineWidth = 10;
        g.strokeRect(5, 5, w - 10, h - 10);
      }
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
// Braga's arms, simply drawn: on blue, Santa Maria de Braga crowned with the Child, between two
// silver towers; in chief three escutcheons of Portugal's old arms; the city's mural crown of five
// towers over it, and the scroll with its name.
export const bragaArms = () =>
  canvas(
    512,
    640,
    (g) => {
      g.lineJoin = 'round';
      g.strokeStyle = '#1b1b1f';
      g.lineWidth = 6;
      const silver = '#e9ecef';
      const gold = '#e0b13a';
      // The mural crown: a wall with five crenellated towers.
      g.fillStyle = silver;
      g.fillRect(96, 92, 320, 46);
      g.strokeRect(96, 92, 320, 46);
      for (let k = 0; k < 5; k++) {
        const x = 104 + k * 64;
        g.fillRect(x, 40, 48, 56);
        g.strokeRect(x, 40, 48, 56);
        for (let m = 0; m < 3; m++) {
          g.fillRect(x + m * 18 - 2, 24, 12, 18);
          g.strokeRect(x + m * 18 - 2, 24, 12, 18);
        }
        g.fillStyle = '#1b1b1f';
        g.fillRect(x + 18, 62, 12, 22);
        g.fillStyle = silver;
      }
      // The shield: square at the top, round at the bottom.
      const shield = () => {
        g.beginPath();
        g.moveTo(76, 150);
        g.lineTo(436, 150);
        g.lineTo(436, 420);
        g.quadraticCurveTo(436, 560, 256, 584);
        g.quadraticCurveTo(76, 560, 76, 420);
        g.closePath();
      };
      shield();
      g.fillStyle = '#1f4e9c';
      g.fill();
      g.save();
      shield();
      g.clip();
      // The chief, silver, with three blue escutcheons, each with five silver bezants.
      g.fillStyle = silver;
      g.fillRect(76, 150, 360, 92);
      g.beginPath();
      g.moveTo(76, 242);
      g.lineTo(436, 242);
      g.stroke();
      for (const cx of [156, 256, 356]) {
        g.fillStyle = '#1f4e9c';
        g.beginPath();
        g.moveTo(cx - 26, 164);
        g.lineTo(cx + 26, 164);
        g.lineTo(cx + 26, 200);
        g.quadraticCurveTo(cx + 26, 228, cx, 232);
        g.quadraticCurveTo(cx - 26, 228, cx - 26, 200);
        g.closePath();
        g.fill();
        g.lineWidth = 4;
        g.stroke();
        g.fillStyle = '#ffffff';
        for (const [dx, dy] of [[-12, 180], [12, 180], [0, 196], [-12, 212], [12, 212]]) {
          g.beginPath();
          g.arc(cx + dx, dy, 5, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.lineWidth = 6;
      // The two towers.
      for (const x of [108, 340]) {
        g.fillStyle = silver;
        g.fillRect(x, 330, 64, 200);
        g.strokeRect(x, 330, 64, 200);
        for (let m = 0; m < 3; m++) {
          g.fillRect(x + 2 + m * 22, 306, 16, 26);
          g.strokeRect(x + 2 + m * 22, 306, 16, 26);
        }
        g.fillStyle = '#1b1b1f';
        g.fillRect(x + 22, 470, 20, 60);
        g.fillRect(x + 26, 380, 12, 28);
      }
      // Santa Maria, crowned, in her mantle, the Child on her arm.
      g.fillStyle = gold;
      g.beginPath();
      g.moveTo(256, 300);
      g.lineTo(316, 540);
      g.lineTo(196, 540);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#f2d2b6';
      g.beginPath();
      g.arc(256, 286, 26, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = gold;
      g.beginPath();
      g.moveTo(232, 266);
      g.lineTo(236, 236);
      g.lineTo(246, 252);
      g.lineTo(256, 230);
      g.lineTo(266, 252);
      g.lineTo(276, 236);
      g.lineTo(280, 266);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#f2d2b6';
      g.beginPath();
      g.arc(286, 372, 16, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
      shield();
      g.stroke();
      // The scroll with the city's name.
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(60, 586);
      g.quadraticCurveTo(256, 556, 452, 586);
      g.lineTo(452, 632);
      g.quadraticCurveTo(256, 602, 60, 632);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#1b1b1f';
      g.font = '900 38px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('BRAGA', 256, 598);
    },
    false,
  );

// A word in a flowing script on nothing, for painting on things: the Tourigalo's name on its
// flanks, the restaurant's sign. `edge` outlines it.
export const script = (text: string, color: string, edge = '', w = 1024, h = 256) =>
  canvas(
    w,
    h,
    (g) => {
      let size = h * 0.72;
      const font = () => `italic 700 ${size}px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive`;
      g.font = font();
      while (g.measureText(text).width > w * 0.94) {
        size -= 4;
        g.font = font();
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (edge) {
        g.strokeStyle = edge;
        g.lineWidth = size * 0.09;
        g.lineJoin = 'round';
        g.strokeText(text, w / 2, h / 2);
      }
      g.fillStyle = color;
      g.fillText(text, w / 2, h / 2);
    },
    false,
  );

// A clock's face: cream, its minutes and hours marked, 12 at the top.
export const clockFace = () =>
  canvas(
    256,
    256,
    (g) => {
      g.fillStyle = '#fbf6e8';
      g.beginPath();
      g.arc(128, 128, 126, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1b1b1d';
      for (let k = 0; k < 60; k++) {
        const a = (k / 60) * Math.PI * 2;
        const r0 = k % 5 ? 108 : 96;
        g.lineWidth = k % 5 ? 3 : 8;
        g.beginPath();
        g.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0);
        g.lineTo(128 + Math.sin(a) * 118, 128 - Math.cos(a) * 118);
        g.stroke();
      }
      g.fillStyle = '#1b1b1d';
      g.font = '800 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [n, a] of [[12, 0], [3, 0.25], [6, 0.5], [9, 0.75]] as const) g.fillText(String(n), 128 + Math.sin(a * Math.PI * 2) * 70, 128 - Math.cos(a * Math.PI * 2) * 70);
    },
    false,
  );

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
      g.strokeStyle = color;
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(128 - w / 2 + 2, 10, w - 4, 42, 12);
      g.stroke();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 128, 32, 220);
    },
    false,
  );
}

// Blue and white azulejos, as on the Palácio do Raio: a tile pattern with granite-framed windows.
export function azulejo(floors: number): THREE.CanvasTexture {
  return canvas(
    256,
    96 * floors,
    (g) => {
      const h = 96 * floors;
      g.fillStyle = '#f2f5fb';
      g.fillRect(0, 0, 256, h);
      for (let y = 0; y < h; y += 16) {
        for (let x = 0; x < 256; x += 16) {
          g.fillStyle = '#2f5aa8';
          g.beginPath();
          g.arc(x + 8, y + 8, 4.5, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#7da1db';
          g.fillRect(x, y + 7, 16, 2);
          g.fillRect(x + 7, y, 2, 16);
        }
      }
      for (let f = 0; f < floors; f++) {
        for (const x of [24, 104, 184]) {
          const y = f * 96 + 18;
          g.fillStyle = '#b9b2a4';
          g.fillRect(x - 8, y - 12, 64, 78);
          g.beginPath();
          g.moveTo(x - 10, y - 10);
          g.quadraticCurveTo(x + 24, y - 30, x + 58, y - 10);
          g.fill();
          g.fillStyle = f === 0 && x === 104 ? '#4a2e1c' : '#25344a';
          g.fillRect(x, y, 48, 60);
          g.fillStyle = 'rgba(255,255,255,0.25)';
          g.fillRect(x + 4, y + 4, 18, 26);
        }
      }
    },
    false,
  );
}

// A town house front: plaster, granite frames round the windows, shutters, iron balconies.
export function townFacade(color: string, floors: number, shutters: string): THREE.CanvasTexture {
  return canvas(
    128,
    64 * floors,
    (g) => {
      const H = 64 * floors;
      g.fillStyle = color;
      g.fillRect(0, 0, 128, H);
      noise(g, 128, H, 700, 0.05);
      g.fillStyle = '#a8a196';
      g.fillRect(0, 0, 5, H);
      g.fillRect(123, 0, 5, H);
      g.fillRect(0, H - 6, 128, 6);
      for (let f = 0; f < floors; f++) {
        const ground = f === floors - 1;
        for (const x of [14, 54, 94]) {
          const y = f * 64 + 12;
          g.fillStyle = '#b3ab9d';
          g.fillRect(x - 4, y - 4, 28, 44);
          const door = ground && x === 54;
          g.fillStyle = door ? '#5a3a22' : '#22303f';
          g.fillRect(x, y, 20, door ? 40 : 34);
          if (!door) {
            g.fillStyle = 'rgba(255,240,200,0.18)';
            g.fillRect(x + 2, y + 2, 7, 14);
            g.fillStyle = shutters;
            g.fillRect(x - 9, y, 6, 34);
            g.fillRect(x + 23, y, 6, 34);
          }
          if (!ground) {
            g.fillStyle = '#2a2a2a';
            g.fillRect(x - 6, y + 34, 32, 3);
            for (let k = 0; k < 6; k++) g.fillRect(x - 5 + k * 6, y + 26, 1.5, 9);
          }
        }
      }
    },
    false,
  );
}

// The item box: a white question mark on blue glass, the blues of the azulejos.
export const itemBox = () =>
  canvas(
    128,
    128,
    (g) => {
      const grad = g.createLinearGradient(0, 0, 128, 128);
      grad.addColorStop(0, 'rgba(29,79,156,0.85)');
      grad.addColorStop(0.5, 'rgba(79,134,214,0.85)');
      grad.addColorStop(1, 'rgba(156,195,240,0.85)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 8;
      g.strokeRect(4, 4, 120, 120);
      g.fillStyle = '#ffffff';
      g.font = '900 88px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('?', 64, 70);
    },
    false,
  );

// A blade of grass, for the tufts: transparent around it.
export const grassBlade = () =>
  canvas(
    64,
    64,
    (g) => {
      for (let i = 0; i < 9; i++) {
        const x = 6 + i * 6.5;
        g.strokeStyle = `rgba(${70 + i * 6},${120 + (i % 3) * 18},${40},1)`;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x, 64);
        g.quadraticCurveTo(x + (i % 2 ? 6 : -6), 30, x + (i % 2 ? 9 : -4), 4 + (i % 4) * 6);
        g.stroke();
      }
    },
    false,
  );

// Ripples, as a normal map for the river and the lake.
export function ripples(): THREE.CanvasTexture {
  const t = ripplesRaw();
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function ripplesRaw(): THREE.CanvasTexture {
  const N = 128;
  const hgt = new Float32Array(N * N);
  for (let k = 0; k < 24; k++) {
    const fx = 1 + Math.floor(Math.random() * 6);
    const fy = 1 + Math.floor(Math.random() * 6);
    const ph = Math.random() * 6.28;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) hgt[y * N + x] += Math.sin(((x * fx + y * fy) / N) * Math.PI * 2 + ph) / (fx + fy);
  }
  return canvas(N, N, (g) => {
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x - 1 + N) % N)];
        const dy = hgt[((y + 1) % N) * N + x] - hgt[((y - 1 + N) % N) * N + x];
        const o = (y * N + x) * 4;
        img.data[o] = 128 - dx * 90;
        img.data[o + 1] = 128 - dy * 90;
        img.data[o + 2] = 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

// For landmarks that draw their own façades.
export const drawTexture = canvas;

// Several drawings as the layers of one texture, each drawn to w × h: so meshes that would each have
// had their own can be one mesh, each vertex saying which layer it takes.
export function layered(images: HTMLCanvasElement[], w: number, h: number): THREE.DataArrayTexture {
  const data = new Uint8Array(w * h * 4 * images.length);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  images.forEach((img, k) => {
    g.clearRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    data.set(g.getImageData(0, 0, w, h).data, k * w * h * 4);
  });
  const t = new THREE.DataArrayTexture(data, w, h, images.length);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// ---- The Volta dos Amigos: Braga's buildings, roofs and streets. ----
// The walls are painted near white so each building's own colour (its vertex colours) tints
// them. One tile is 6 m wide and one floor (3 m) tall.

// A floor of flats: two windows in granite frames, shutters, an iron balcony rail.
export const flatsFloor = () =>
  canvas(256, 128, (g) => {
    g.fillStyle = '#f3f1ec';
    g.fillRect(0, 0, 256, 128);
    noise(g, 256, 128, 900, 0.04);
    for (const x of [40, 158]) {
      g.fillStyle = '#c7c1b4';
      g.fillRect(x - 7, 18, 72, 92);
      g.fillStyle = '#26303d';
      g.fillRect(x, 24, 58, 76);
      g.fillStyle = 'rgba(190,215,240,0.28)';
      g.fillRect(x + 4, 28, 22, 34);
      g.fillStyle = '#e9e6df';
      g.fillRect(x + 27, 24, 4, 76);
      g.fillStyle = '#3f5a48';
      g.fillRect(x - 16, 24, 9, 76);
      g.fillRect(x + 65, 24, 9, 76);
      g.fillStyle = '#2b2b2b';
      g.fillRect(x - 10, 88, 78, 4);
      for (let k = 0; k < 9; k++) g.fillRect(x - 8 + k * 9, 92, 2, 16);
      g.fillRect(x - 10, 106, 78, 3);
    }
  });

// A ground floor: a door and a shop window under a stone band.
export const groundFloor = () =>
  canvas(256, 128, (g) => {
    g.fillStyle = '#e3ddd1';
    g.fillRect(0, 0, 256, 128);
    noise(g, 256, 128, 900, 0.05);
    g.fillStyle = '#b4ad9f';
    g.fillRect(0, 0, 256, 12);
    g.fillRect(0, 118, 256, 10);
    g.fillStyle = '#4a3324';
    g.fillRect(30, 34, 44, 86);
    g.fillStyle = '#6b4b33';
    g.fillRect(34, 38, 36, 78);
    g.fillStyle = '#1f2a36';
    g.fillRect(104, 30, 128, 80);
    g.fillStyle = 'rgba(255,236,190,0.35)';
    g.fillRect(110, 36, 52, 68);
    g.fillStyle = '#b4ad9f';
    g.fillRect(100, 26, 136, 6);
  });

// A house's walls: a window in a granite frame, with shutters, and plaster round it.
export const houseWall = () =>
  canvas(256, 128, (g) => {
    g.fillStyle = '#f5f3ee';
    g.fillRect(0, 0, 256, 128);
    noise(g, 256, 128, 1100, 0.05);
    g.fillStyle = '#bcb5a7';
    g.fillRect(94, 26, 68, 78);
    g.fillStyle = '#2a333f';
    g.fillRect(102, 32, 52, 64);
    g.fillStyle = 'rgba(190,215,240,0.25)';
    g.fillRect(106, 36, 20, 28);
    g.fillStyle = '#7a3b2b';
    g.fillRect(80, 32, 12, 64);
    g.fillRect(164, 32, 12, 64);
    g.fillStyle = '#bcb5a7';
    g.fillRect(0, 122, 256, 6);
  });

// A shop, a warehouse or a school: render panels and a long band of windows.
export const shopWall = () =>
  canvas(256, 128, (g) => {
    g.fillStyle = '#ecebe6';
    g.fillRect(0, 0, 256, 128);
    noise(g, 256, 128, 800, 0.05);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 2, 128);
    g.fillStyle = '#2b3846';
    g.fillRect(0, 44, 256, 40);
    g.fillStyle = 'rgba(200,225,245,0.3)';
    for (let x = 6; x < 256; x += 32) g.fillRect(x, 48, 12, 32);
    g.fillStyle = '#9ea3a6';
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 44, 3, 40);
  });

// Church walls: white plaster with granite bands and tall windows.
export const churchWall = () =>
  canvas(256, 128, (g) => {
    g.fillStyle = '#f6f4ef';
    g.fillRect(0, 0, 256, 128);
    noise(g, 256, 128, 700, 0.04);
    g.fillStyle = '#b8b0a0';
    g.fillRect(0, 0, 256, 6);
    g.fillRect(0, 0, 10, 128);
    g.fillStyle = '#3a4250';
    g.beginPath();
    g.roundRect(112, 20, 32, 96, [16, 16, 0, 0]);
    g.fill();
  });

// Roof tiles, Minho terracotta, in rows; tinted per building.
export const roofTiles = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#e7e2dc';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      g.fillStyle = 'rgba(70,40,30,0.35)';
      g.fillRect(0, y + 13, 256, 3);
      for (let x = (y / 16) % 2 ? 8 : 0; x < 256; x += 16) {
        const l = 225 + Math.random() * 30;
        g.fillStyle = `rgb(${l},${l - 6},${l - 12})`;
        g.beginPath();
        g.roundRect(x + 1, y, 14, 13, [0, 0, 7, 7]);
        g.fill();
      }
    }
    noise(g, 256, 256, 3000, 0.06);
  });

// A flat roof: gravel, a few patches and vents; near white, tinted per building with its colour
// from the aerial photo.
export const flatRoof = () =>
  canvas(256, 256, (g) => {
    g.fillStyle = '#ecebe8';
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 16000, 0.12);
    for (let i = 0; i < 6; i++) {
      const l = 150 + Math.random() * 60;
      g.fillStyle = `rgba(${l},${l},${l},0.25)`;
      g.fillRect(Math.random() * 220, Math.random() * 220, 20 + Math.random() * 40, 20 + Math.random() * 40);
    }
  });

// A streak of air for the slipstream: clear at both ends, brightest just behind the middle.
export function windStreak(): THREE.CanvasTexture {
  return canvas(
    128,
    4,
    (g) => {
      const grad = g.createLinearGradient(0, 0, 128, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.35, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 4);
    },
    false,
  );
}

// Grain for the ground: multiplied into its colours, tiled every few metres, so the big map
// painted under everything doesn't look smeared up close. Linear, not a colour.
export function grain(): THREE.CanvasTexture {
  const t = canvas(256, 256, (g) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26000; i++) {
      const v = 70 + Math.random() * 120;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Every street name on its own blue-and-white azulejo plate, stacked in one texture: plate k
// spans v from 1 - (k + 1) / n to 1 - k / n.
export function streetPlates(names: string[]): THREE.CanvasTexture {
  const W = 512, H = 112;
  return canvas(
    W,
    H * Math.max(1, names.length),
    (g) => {
      names.forEach((name, k) => {
        const y = k * H;
        g.fillStyle = '#f7f8fb';
        g.fillRect(0, y, W, H);
        g.strokeStyle = '#2f5aa8';
        g.lineWidth = 8;
        g.strokeRect(10, y + 10, W - 20, H - 20);
        g.strokeStyle = '#7da1db';
        g.lineWidth = 2;
        for (let x = 0; x <= W; x += 64) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + H);
          g.stroke();
        }
        g.fillStyle = '#1f3f86';
        let size = 40;
        g.font = `700 ${size}px Georgia, serif`;
        while (g.measureText(name).width > W - 60 && size > 18) g.font = `700 ${(size -= 2)}px Georgia, serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(name, W / 2, y + H / 2 + 2);
      });
    },
    false,
  );
}

// A brown tourist sign, as for monuments in Portugal.
export function brownSign(text: string): THREE.CanvasTexture {
  return canvas(
    512,
    128,
    (g) => {
      g.fillStyle = '#6e4a2c';
      g.fillRect(0, 0, 512, 128);
      g.strokeStyle = '#f4efe6';
      g.lineWidth = 6;
      g.strokeRect(8, 8, 496, 112);
      g.fillStyle = '#f4efe6';
      let size = 46;
      g.font = `700 ${size}px system-ui, sans-serif`;
      while (g.measureText(text).width > 460 && size > 20) g.font = `700 ${(size -= 2)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, 66);
    },
    false,
  );
}
