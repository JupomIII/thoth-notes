// Generates the PWA icon set without any image dependency.
// Rasterises a simple geometric Thoth mark and writes PNG chunks by hand.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const PAPER = [250, 248, 244, 255];
const ACCENT = [74, 97, 86, 255];
const INK = [31, 29, 26, 255];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeCanvas(size) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = PAPER[0];
    data[i * 4 + 1] = PAPER[1];
    data[i * 4 + 2] = PAPER[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

function blend(data, size, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  const a = color[3] / 255 * alpha;
  data[i] = Math.round(data[i] * (1 - a) + color[0] * a);
  data[i + 1] = Math.round(data[i + 1] * (1 - a) + color[1] * a);
  data[i + 2] = Math.round(data[i + 2] * (1 - a) + color[2] * a);
  data[i + 3] = 255;
}

function roundRect(data, size, x0, y0, w, h, radius, color) {
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      const dx = Math.min(Math.abs(x - x0), Math.abs(x - (x0 + w - 1)));
      const dy = Math.min(Math.abs(y - y0), Math.abs(y - (y0 + h - 1)));
      if (dx < radius && dy < radius) {
        if (Math.hypot(radius - dx, radius - dy) > radius) continue;
      }
      blend(data, size, x, y, color);
    }
  }
}

function drawMark(data, size, padding, background) {
  const inner = size - padding * 2;
  if (background) roundRect(data, size, 0, 0, size, size, background.radius, background.color);
  const cx = size / 2;
  const top = padding + inner * 0.26;
  const bottom = size - padding - inner * 0.24;
  const barW = inner * 0.62;
  const stroke = inner * 0.115;
  roundRect(data, size, cx - barW / 2, top, barW, stroke, stroke / 2, INK);
  roundRect(data, size, cx - stroke / 2, top, stroke, bottom - top, stroke / 2, INK);
  // Feather-like serif on the stem.
  roundRect(data, size, cx - inner * 0.16, top + inner * 0.35, inner * 0.32, stroke * 0.86, stroke / 2, ACCENT);
  roundRect(data, size, cx - inner * 0.12, top + inner * 0.55, inner * 0.24, stroke * 0.8, stroke / 2, ACCENT);
}

function writeIcon(name, size, padding, background) {
  const data = makeCanvas(size);
  drawMark(data, size, padding, background);
  writeFileSync(join(outDir, name), encodePng(size, size, data));
}

writeIcon('icon-192.png', 192, 24, { radius: 42, color: ACCENT });
writeIcon('icon-512.png', 512, 62, { radius: 112, color: ACCENT });
writeIcon('icon-maskable-512.png', 512, 128, { radius: 0, color: ACCENT });
writeIcon('apple-touch-icon.png', 180, 0, { radius: 0, color: ACCENT });

// Recolour the glyph on accent backgrounds for legibility.
for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
  const raw = makeCanvas(name === 'icon-192.png' ? 192 : name === 'apple-touch-icon.png' ? 180 : 512);
  const size = name === 'icon-192.png' ? 192 : name === 'apple-touch-icon.png' ? 180 : 512;
  const padding = name === 'icon-192.png' ? 24 : name === 'apple-touch-icon.png' ? 0 : name === 'icon-512.png' ? 62 : 128;
  // Paper glyph on the accent field.
  const accentField = Buffer.from(raw);
  void accentField;
  for (let i = 0; i < size * size; i++) {
    raw[i * 4] = ACCENT[0];
    raw[i * 4 + 1] = ACCENT[1];
    raw[i * 4 + 2] = ACCENT[2];
    raw[i * 4 + 3] = 255;
  }
  const inner = size - padding * 2;
  const cx = size / 2;
  const top = padding + inner * 0.26;
  const bottom = size - padding - inner * 0.24;
  const barW = inner * 0.62;
  const stroke = inner * 0.115;
  roundRect(raw, size, cx - barW / 2, top, barW, stroke, stroke / 2, PAPER);
  roundRect(raw, size, cx - stroke / 2, top, stroke, bottom - top, stroke / 2, PAPER);
  writeFileSync(join(outDir, name), encodePng(size, size, raw));
}

console.log('Icons written to public/icons');
