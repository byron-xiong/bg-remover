/* 纯工具函数：UI 显示 / 格式化 / 数值限制
 * 不依赖 DOM，可在 Node 中直接测试。 */

/* 数值限制在 [min, max]。NaN 时返回 null。 */
export function clamp(value, min, max) {
  if (Number.isNaN(value)) return null;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/* 0–1 范围的百分比限制。常用于 quality / 不透明度等。 */
export function clamp01(v) {
  return clamp(v, 0, 1);
}

/* 背景类型 → canvas 填充。
 * kind: 'transparent' | 'color' | 'gradient' | 'image'
 * 输入：ctx, kind, opts { color, gradientFrom, gradientTo, imageBitmap }, w, h
 * 副作用：在 ctx 上填充 (0,0)-(w,h)。返回 Promise（image 需要 decode）。 */
export async function paintBackground(ctx, kind, opts, w, h) {
  if (kind === 'transparent') return;
  if (kind === 'color') {
    ctx.fillStyle = opts.color || '#ffffff';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (kind === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, opts.gradientFrom || '#6366f1');
    g.addColorStop(1, opts.gradientTo || '#22d3ee');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (kind === 'image' && opts.imageBitmap) {
    // 居中覆盖（object-fit: cover）
    const img = opts.imageBitmap;
    const ratio = Math.max(w / img.width, h / img.height);
    const dw = img.width * ratio;
    const dh = img.height * ratio;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return;
  }
  // 未知类型 → 默认白色
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
}

/* 字节数 → "1.4 MB" / "512 KB" / "0 B"。 */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/* 毫秒 → "0.0s" / "2.3s" / "1m 23.4s"。 */
export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0.0s';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(1);
  return `${m}m ${s}s`;
}

/* 进度 (current/total) → 0–100 的整数百分比；total 缺失/为 0 返回 null。 */
export function percentOf(current, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(current)) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

/* 文件名去后缀，空时回退到 fallback。 */
export function stripExt(name, fallback = 'image') {
  if (!name) return fallback;
  return name.replace(/\.[^.]+$/, '') || fallback;
}

/* 文件 MIME 是否为图片。 */
export function isImageMime(type) {
  return typeof type === 'string' && type.startsWith('image/');
}

/* 下载文件名：原名-cutout.<ext>。 */
export function cutoutFileName(baseName, mime) {
  const ext = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
  }[mime] || '';
  return `${stripExt(baseName)}-cutout${ext}`;
}

/* HEAD 请求检测一个 URL 是否可访问 + CORS 友好。
 * 库调用示例：检查自定义 ONNX 模型 URL。
 * 返回：{ ok: bool, status: number|'fetch-failed', cors: bool, contentLength?: number, error?: string } */
export async function probeUrl(url, { timeoutMs = 8000 } = {}) {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, status: 'bad-url', cors: false, error: '不是 http(s) URL' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    const cors = !!res.headers.get('access-control-allow-origin') || res.type === 'basic' || res.type === 'cors';
    const len = parseInt(res.headers.get('content-length') || '0', 10);
    return {
      ok: res.ok,
      status: res.status,
      cors,
      contentLength: Number.isFinite(len) ? len : 0,
    };
  } catch (e) {
    const msg = String(e?.message || e);
    const isCors = /failed to fetch|cors|opaque/i.test(msg);
    return {
      ok: false,
      status: 'fetch-failed',
      cors: !isCors,
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}