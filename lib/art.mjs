// art.mjs — rasterize the "system desktop" disguise icon (supersampled AA).
import { encodePng } from './png.mjs';

const SS = 4;

const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerpC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function rrDist(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

function render(size, draw) {
  const S = size * SS;
  const big = new Float64Array(S * S * 4);
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
    const i = ((y | 0) * S + (x | 0)) * 4;
    const aa = a / 255;
    big[i] = big[i] * (1 - aa) + r * aa;
    big[i + 1] = big[i + 1] * (1 - aa) + g * aa;
    big[i + 2] = big[i + 2] * (1 - aa) + b * aa;
    big[i + 3] = Math.max(big[i + 3], a);
  };
  const fill = (x0, y0, x1, y1, colorFn, alpha = 1) => {
    const xa = Math.max(0, x0 | 0), xb = Math.min(S, (x1 + 1) | 0);
    const ya = Math.max(0, y0 | 0), yb = Math.min(S, (y1 + 1) | 0);
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const c = colorFn((x + 0.5) / S, (y + 0.5) / S);
        put(x, y, c[0], c[1], c[2], alpha * 255);
      }
    }
  };
  const fillRounded = (cx, cy, hw, hh, r, color, alpha = 1) => {
    const xa = Math.max(0, (cx - hw - 1) | 0), xb = Math.min(S, (cx + hw + 2) | 0);
    const ya = Math.max(0, (cy - hh - 1) | 0), yb = Math.min(S, (cy + hh + 2) | 0);
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        let cov = 0;
        for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const d = rrDist(x + ox, y + oy, cx, cy, hw, hh, r);
          if (d <= 0) cov += 0.25;
          else if (d < 1) cov += 0.25 * (1 - d);
        }
        if (cov > 0) put(x, y, color[0], color[1], color[2], alpha * 255 * cov);
      }
    }
  };
  draw({ S, fill, fillRounded });
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
        r += big[i]; g += big[i + 1]; b += big[i + 2]; a += big[i + 3];
      }
      const n = SS * SS, o = (y * size + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, out);
}

// white 2x2 app grid + dock pill (the shared glyph)
function drawGrid(fx, fy, fw, S, fillRounded, scale = 1, alpha = 1) {
  // fw = logical bbox width inside which grid + pill are drawn, fx/fy = center
  const half = fw * 0.207 * scale;
  const gap = fw * 0.13 * scale;
  const r = fw * 0.1 * scale;
  const cxs = [fx - half - gap / 2, fx + half + gap / 2];
  for (const cx of cxs) for (const cy of cxs) fillRounded(cx, cy, half, half, r, [255, 255, 255], alpha);
  fillRounded(fx, fy + fw * 0.56 * scale, fw * 0.225 * scale, fw * 0.06 * scale, fw * 0.06 * scale, [255, 255, 255], alpha * 0.92);
}

const TOP = '#2E6BEE', BOTTOM = '#5FC7FF';

// Full legacy launcher icon: gradient square + white grid glyph.
export function launcherIconPng(size) {
  const c1 = hex(TOP), c2 = hex(BOTTOM);
  return render(size, ({ S, fill, fillRounded }) => {
    fill(0, 0, S, S, (_x, y) => lerpC(c1, c2, y));
    drawGrid(0.5 * S, 0.44 * S, 0.62 * S, S, fillRounded);
  });
}

// Adaptive-foreground icon: transparent canvas, glyph inside the 66% safe zone.
export function launcherForegroundPng(size) {
  return render(size, ({ S, fillRounded }) => {
    drawGrid(0.5 * S, 0.5 * S, 0.6 * S, S, fillRounded);
  });
}
