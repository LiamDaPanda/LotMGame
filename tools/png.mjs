// Minimal dependency-free PNG encoder + a tiny software rasterizer.
// Used by tools/generate-art.mjs so the project's placeholder art can be
// regenerated from source instead of being committed as opaque binaries.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA byte array as a PNG buffer. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Parse '#rrggbb' or '#rrggbbaa' into [r,g,b,a]. */
export function rgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, alpha === undefined ? a : Math.round(alpha * 255)];
}

/** Lighten (t > 0) or darken (t < 0) a colour toward white/black. */
export function shade(color, t) {
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  return [
    Math.round(color[0] + (target - color[0]) * k),
    Math.round(color[1] + (target - color[1]) * k),
    Math.round(color[2] + (target - color[2]) * k),
    color[3],
  ];
}

/** A software RGBA canvas with source-over blending. */
export class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  px(x, y, color) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const a = color[3] / 255;
    if (a <= 0) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    if (a >= 1) {
      d[i] = color[0];
      d[i + 1] = color[1];
      d[i + 2] = color[2];
      d[i + 3] = 255;
      return;
    }
    const dstA = d[i + 3] / 255;
    const outA = a + dstA * (1 - a);
    for (let c = 0; c < 3; c++) {
      d[i + c] = Math.round((color[c] * a + d[i + c] * dstA * (1 - a)) / (outA || 1));
    }
    d[i + 3] = Math.round(outA * 255);
  }

  get(x, y) {
    const i = ((y | 0) * this.width + (x | 0)) * 4;
    const d = this.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  rect(x, y, w, h, color) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color);
  }

  /** Filled axis-aligned ellipse, inclusive of the radius edge. */
  ellipse(cx, cy, rx, ry, color) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx || 0.5);
        const dy = (y - cy) / (ry || 0.5);
        if (dx * dx + dy * dy <= 1.0) this.px(x, y, color);
      }
    }
  }

  roundRect(x, y, w, h, r, color) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const dx = i < r ? r - i : i >= w - r ? i - (w - r - 1) : 0;
        const dy = j < r ? r - j : j >= h - r ? j - (h - r - 1) : 0;
        if (dx * dx + dy * dy > r * r) continue;
        this.px(x + i, y + j, color);
      }
    }
  }

  line(x0, y0, x1, y1, color) {
    // Bresenham only terminates on integer endpoints — callers pass floats
    // from trig, so snap first.
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Blit another raster at (x, y), skipping fully transparent pixels. */
  blit(src, x, y) {
    for (let j = 0; j < src.height; j++) {
      for (let i = 0; i < src.width; i++) {
        const c = src.get(i, j);
        if (c[3] === 0) continue;
        this.px(x + i, y + j, c);
      }
    }
  }

  toPng() {
    return encodePng(this.width, this.height, this.data);
  }
}

/**
 * Deterministic value noise in [0, 1). Keeps generated textures identical
 * between runs so regenerating art produces no spurious git diffs.
 */
export function noise(x, y, seed = 0) {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695040888963407;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
