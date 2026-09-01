import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  clamp01,
  formatBytes,
  formatElapsed,
  percentOf,
  stripExt,
  isImageMime,
  escapeHtml,
  cutoutFileName,
  paintBackground,
  probeUrl,
} from '../src/utils.js';

describe('clamp', () => {
  it('passes through values in range', () => {
    assert.equal(clamp(5, 0, 10), 5);
  });
  it('clamps to min', () => {
    assert.equal(clamp(-3, 0, 10), 0);
  });
  it('clamps to max', () => {
    assert.equal(clamp(99, 0, 10), 10);
  });
  it('returns null for NaN', () => {
    assert.equal(clamp(NaN, 0, 10), null);
  });
});

describe('clamp01', () => {
  it('clamps to [0, 1]', () => {
    assert.equal(clamp01(-0.5), 0);
    assert.equal(clamp01(0.5), 0.5);
    assert.equal(clamp01(1.5), 1);
  });
  it('returns null for NaN', () => {
    assert.equal(clamp01(NaN), null);
  });
});

describe('formatBytes', () => {
  it('formats bytes', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
  });
  it('formats KB', () => {
    assert.equal(formatBytes(1024), '1.00 KB');
    assert.equal(formatBytes(10 * 1024), '10.0 KB');
  });
  it('formats MB', () => {
    assert.equal(formatBytes(1.4 * 1024 * 1024), '1.40 MB');
    assert.equal(formatBytes(120 * 1024 * 1024), '120 MB');
  });
  it('formats GB', () => {
    assert.equal(formatBytes(2.5 * 1024 ** 3), '2.50 GB');
  });
  it('handles negative / non-finite', () => {
    assert.equal(formatBytes(-1), '0 B');
    assert.equal(formatBytes(NaN), '0 B');
    assert.equal(formatBytes(Infinity), '0 B');
  });
});

describe('formatElapsed', () => {
  it('formats sub-second', () => {
    assert.equal(formatElapsed(0), '0.0s');
    assert.equal(formatElapsed(123), '0.1s');
  });
  it('formats seconds', () => {
    assert.equal(formatElapsed(2300), '2.3s');
  });
  it('formats minutes', () => {
    assert.equal(formatElapsed(83_400), '1m 23.4s');
  });
  it('handles negative / non-finite', () => {
    assert.equal(formatElapsed(-1), '0.0s');
    assert.equal(formatElapsed(NaN), '0.0s');
  });
});

describe('percentOf', () => {
  it('computes ratio', () => {
    assert.equal(percentOf(1, 4), 25);
    assert.equal(percentOf(50, 100), 50);
  });
  it('rounds and clamps', () => {
    assert.equal(percentOf(33, 99), 33);
    assert.equal(percentOf(150, 100), 100);
    assert.equal(percentOf(-10, 100), 0);
  });
  it('returns null when total missing', () => {
    assert.equal(percentOf(50, 0), null);
    assert.equal(percentOf(50, undefined), null);
    assert.equal(percentOf(50, NaN), null);
  });
});

describe('stripExt', () => {
  it('strips common extensions', () => {
    assert.equal(stripExt('photo.png'), 'photo');
    assert.equal(stripExt('my.photo.jpg'), 'my.photo');
  });
  it('returns name as-is when no extension', () => {
    assert.equal(stripExt('photo'), 'photo');
  });
  it('falls back when empty', () => {
    assert.equal(stripExt(''), 'image');
    assert.equal(stripExt('.hidden'), 'image');
  });
});

describe('isImageMime', () => {
  it('matches image/*', () => {
    assert.equal(isImageMime('image/png'), true);
    assert.equal(isImageMime('image/jpeg'), true);
  });
  it('rejects non-image', () => {
    assert.equal(isImageMime('application/pdf'), false);
    assert.equal(isImageMime(''), false);
    assert.equal(isImageMime(null), false);
  });
});

describe('escapeHtml', () => {
  it('escapes markup-sensitive characters', () => {
    assert.equal(escapeHtml('<img src="x"> & \'quoted\''), '&lt;img src=&quot;x&quot;&gt; &amp; &#39;quoted&#39;');
  });
  it('handles non-string values', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(42), '42');
  });
});

describe('cutoutFileName', () => {
  it('appends correct extension', () => {
    assert.equal(cutoutFileName('photo', 'image/png'), 'photo-cutout.png');
    assert.equal(cutoutFileName('photo.jpg', 'image/jpeg'), 'photo-cutout.jpg');
    assert.equal(cutoutFileName('photo', 'image/webp'), 'photo-cutout.webp');
  });
  it('handles unknown mime', () => {
    assert.equal(cutoutFileName('photo', 'image/avif'), 'photo-cutout');
  });
});

/* paintBackground 需要一个最小化的 2D ctx mock。
 * 只 fillRect / createLinearGradient / drawImage / fillStyle 被用到。 */
function makeCtxMock() {
  const calls = [];
  let gradientRef = null;
  const gradient = {
    addColorStop: (p, c) => calls.push(['stop', p, c]),
    __self: null,
  };
  return {
    calls,
    get fillStyle() { return gradientRef; },
    set fillStyle(v) { gradientRef = v; },
    fillRect: (x, y, w, h) => calls.push(['fillRect', x, y, w, h]),
    createLinearGradient: (x1, y1, x2, y2) => {
      calls.push(['linearGradient', x1, y1, x2, y2]);
      return gradient;
    },
    drawImage: (...args) => calls.push(['drawImage', ...args]),
  };
}

describe('paintBackground', () => {
  it('transparent does nothing', async () => {
    const ctx = makeCtxMock();
    await paintBackground(ctx, 'transparent', {}, 10, 10);
    assert.equal(ctx.calls.length, 0);
  });
  it('color fills with hex', async () => {
    const ctx = makeCtxMock();
    await paintBackground(ctx, 'color', { color: '#ff0000' }, 10, 10);
    assert.equal(ctx.fillStyle, '#ff0000');
    assert.deepEqual(ctx.calls[0], ['fillRect', 0, 0, 10, 10]);
  });
  it('gradient creates linear gradient', async () => {
    const ctx = makeCtxMock();
    await paintBackground(ctx, 'gradient', { gradientFrom: '#000', gradientTo: '#fff' }, 100, 50);
    assert.ok(ctx.calls.some((c) => c[0] === 'linearGradient' && c[1] === 0 && c[2] === 0 && c[3] === 100 && c[4] === 50));
    assert.ok(ctx.calls.some((c) => c[0] === 'stop' && c[1] === 0 && c[2] === '#000'));
    assert.ok(ctx.calls.some((c) => c[0] === 'stop' && c[1] === 1 && c[2] === '#fff'));
  });
  it('image draws cover-fit', async () => {
    const ctx = makeCtxMock();
    const img = { width: 100, height: 50 };
    await paintBackground(ctx, 'image', { imageBitmap: img }, 200, 100);
    // ratio=2, dw=200, dh=100, 居中 = (0,0)
    assert.deepEqual(ctx.calls[0], ['drawImage', img, 0, 0, 200, 100]);
  });
  it('unknown kind defaults to white', async () => {
    const ctx = makeCtxMock();
    await paintBackground(ctx, 'bogus', {}, 10, 10);
    assert.equal(ctx.fillStyle, '#ffffff');
  });
});

describe('probeUrl', () => {
  it('rejects non-http URLs', async () => {
    const r = await probeUrl('ftp://example.com/m.onnx');
    assert.equal(r.ok, false);
    assert.equal(r.status, 'bad-url');
    assert.match(r.error, /http/);
  });
  it('returns fetch-failed on unreachable host', async () => {
    const r = await probeUrl('https://nonexistent-host-asdfqwer.invalid/m.onnx', { timeoutMs: 1500 });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'fetch-failed');
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  });
});