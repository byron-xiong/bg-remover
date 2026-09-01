/* 纯前端 AI 抠图 — 基于 @imgly/background-removal (ISNet ONNX)
 * 图片全程不离开本机：模型经 CDN 加载后在浏览器内推理。 */

import { percentOf, formatBytes, formatElapsed, stripExt, isImageMime, escapeHtml, cutoutFileName, paintBackground, probeUrl } from './src/utils.js';
import {
  createQueue,
  enqueue,
  enqueueMany,
  updateItem,
  removeItem,
  clearFinished,
  overallProgress,
  stats as queueStats,
  uniqueZipName,
  STATUS,
} from './src/queue.js';

const $ = (id) => document.getElementById(id);

const els = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  workspace: $('workspace'),
  sourceImg: $('sourceImg'),
  changeBtn: $('changeBtn'),
  resultCanvas: $('resultCanvas'),
  resultPlaceholder: $('resultPlaceholder'),
  resultWrap: $('resultWrap'),
  brushCursor: $('brushCursor'),
  editorBar: $('editorBar'),
  toolRestore: $('toolRestore'),
  toolErase: $('toolErase'),
  brushSize: $('brushSize'),
  brushSizeVal: $('brushSizeVal'),
  undoBtn: $('undoBtn'),
  resetEditBtn: $('resetEditBtn'),
  fxBar: $('fxBar'),
  strokeToggle: $('strokeToggle'),
  strokeColor: $('strokeColor'),
  strokeWidth: $('strokeWidth'),
  strokeWidthVal: $('strokeWidthVal'),
  shadowToggle: $('shadowToggle'),
  shadowSize: $('shadowSize'),
  shadowSizeVal: $('shadowSizeVal'),
  timing: $('timing'),
  model: $('modelSelect'),
  device: $('deviceSelect'),
  deviceHint: $('deviceHint'),
  outType: $('outTypeSelect'),
  format: $('formatSelect'),
  qualityRow: $('qualityRow'),
  quality: $('qualityRange'),
  qualityVal: $('qualityVal'),
  colorRow: $('colorRow'),
  applyBg: $('applyBgCheck'),
  bgColor: $('bgColorInput'),
  bgKindSelect: $('bgKindSelect'),
  bgGradFrom: $('bgGradFrom'),
  bgGradTo: $('bgGradTo'),
  bgImageInput: $('bgImageInput'),
  bgImageBtn: $('bgImageBtn'),
  bgImageName: $('bgImageName'),
  processBtn: $('processBtn'),
  downloadBtn: $('downloadBtn'),
  resetBtn: $('resetBtn'),
  redoBtn: $('redoBtn'),
  customModelRow: $('customModelRow'),
  modelUrl: $('modelUrl'),
  probeModelBtn: $('probeModelBtn'),
  probeStatus: $('probeStatus'),
  cacheStatus: $('cacheStatus'),
  cacheUsage: $('cacheUsage'),
  cacheQuota: $('cacheQuota'),
  prefetchBtn: $('prefetchBtn'),
  clearCacheBtn: $('clearCacheBtn'),
  sizePresetSelect: $('sizePresetSelect'),
  sizeHint: $('sizeHint'),
  modeSingle: $('modeSingle'),
  modeBatch: $('modeBatch'),
  batchPanel: $('batchPanel'),
  batchFileInput: $('batchFileInput'),
  batchAddBtn: $('batchAddBtn'),
  batchStartBtn: $('batchStartBtn'),
  batchDownloadBtn: $('batchDownloadBtn'),
  batchClearBtn: $('batchClearBtn'),
  batchBarFill: $('batchBarFill'),
  batchStats: $('batchStats'),
  batchElapsed: $('batchElapsed'),
  batchList: $('batchList'),
  singleActions: $('singleActions'),
  dropzoneTitle: $('dropzoneTitle'),
  dropzoneHint: $('dropzoneHint'),
  loadingOverlay: $('loadingOverlay'),
  loadingStage: $('loadingStage'),
  loadingSteps: $('loadingSteps'),
  loadingBarBox: $('loadingBarBox'),
  loadingBarFill: $('loadingBarFill'),
  loadingPct: $('loadingPct'),
  loadingElapsed: $('loadingElapsed'),
  firstRunHint: $('firstRunHint'),
  errorMsg: $('errorMsg'),
  errorText: $('errorText'),
  errorClose: $('errorClose'),
  chips: $('backendChips'),
};

/* ---------- 状态 ---------- */
const state = {
  mode: 'single',         // 'single' | 'batch'
  file: null,
  fileName: '',
  sourceUrl: null,
  aiBlob: null,         // AI 原始输出（透明 PNG）
  originalBitmap: null, // 原图位图，供「恢复」笔刷取像素
  undoStack: [],
  redoStack: [],
  editCanvas: document.createElement('canvas'), // 可修整的编辑画布（原始尺寸）
  batch: createQueue(), // 批量队列
  bgImageBitmap: null,  // 自定义背景图位图
  bgImageUrl: null,     // 自定义背景图对象 URL
};

/* ---------- 库懒加载（首次调用才拉取脚本与模型） ---------- */
let libPromise = null;
const loadLib = () =>
  (libPromise ??= import(
    'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm'
  ));

/* ---------- 运行环境探测 ---------- */
(function detectBackends() {
  const chips = [];
  chips.push(navigator.gpu ? ['WebGPU ✓', 'ok'] : ['WebGPU ✗', 'off']);
  try {
    const cv = document.createElement('canvas');
    chips.push(cv.getContext('webgl2') ? ['WebGL2 ✓', 'ok'] : ['WebGL2 ✗', 'off']);
  } catch {
    chips.push(['WebGL2 ?', 'off']);
  }
  chips.push(['WASM ✓', 'ok']);
  els.chips.innerHTML = chips
    .map(([t, cls]) => `<span class="chip ${cls}">${t}</span>`)
    .join('');
  els.deviceHint.textContent = navigator.gpu
    ? '已检测到 WebGPU · 自动模式将启用显卡加速'
    : '未检测到 WebGPU · 将使用 CPU 推理（Chrome/Edge 最新版可启用）';
})();

/* ---------- 进度回调 ---------- */
const STAGE_CN = {
  download: '下载模型',
  load: '加载模型',
  run: '模型推理',
  postprocess: '后处理',
};

const STEP_ORDER = ['download', 'load', 'run', 'postprocess'];

function onProgress(key, current, total) {
  els.loadingStage.textContent = STAGE_CN[key] || key || '处理中';
  const idx = STEP_ORDER.indexOf(key);
  els.loadingSteps.querySelectorAll('span').forEach((sp, i) => {
    sp.classList.toggle('active', i === idx);
    sp.classList.toggle('done', idx >= 0 && i < idx);
  });
  if (!total) {
    // 该阶段无进度信息 → 不确定态滚动条
    els.loadingBarBox.classList.add('indeterminate');
    els.loadingPct.textContent = '';
    return;
  }
  els.loadingBarBox.classList.remove('indeterminate');
  const pct = percentOf(current, total) ?? 0;
  els.loadingBarFill.style.width = pct + '%';
  els.loadingPct.textContent = pct + '%';
}

/* ---------- 处理中遮罩 / 实时计时 ---------- */
let elapsedTimer = null;

function startElapsed() {
  const t0 = performance.now();
  els.loadingElapsed.textContent = '已用 ' + formatElapsed(0);
  elapsedTimer = setInterval(() => {
    els.loadingElapsed.textContent = '已用 ' + formatElapsed(performance.now() - t0);
  }, 100);
}

function stopElapsed() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function showLoading() {
  els.resultPlaceholder.style.display = 'none';
  els.loadingOverlay.classList.remove('hidden');
  els.loadingStage.textContent = '准备中…';
  els.loadingBarBox.classList.remove('indeterminate');
  els.loadingBarFill.style.width = '0%';
  els.loadingPct.textContent = '';
  els.loadingSteps.querySelectorAll('span').forEach((sp) =>
    sp.classList.remove('active', 'done')
  );
  // 滚动到结果面板，确保用户能看到进度
  els.resultWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideLoading() {
  els.loadingOverlay.classList.add('hidden');
  stopElapsed();
}

/* ---------- 错误提示（顶部浮层 + 常见原因提示） ---------- */
function friendlyError(err) {
  const msg = String(err?.message || err);
  if (/fetch|network|load failed/i.test(msg))
    return msg + ' —— 可能是网络无法访问 CDN（jsDelivr），请检查网络或代理后重试';
  if (/memory|allocat/i.test(msg))
    return msg + ' —— 可能是内存不足，可尝试缩小图片尺寸或改用 quint8 模型';
  if (/webgpu/i.test(msg))
    return msg + ' —— WebGPU 初始化异常，可换用 Chrome/Edge 最新版或稍后重试';
  return msg;
}

function showError(msg) {
  els.errorText.textContent = msg;
  els.errorMsg.classList.remove('hidden');
}
function hideError() {
  els.errorMsg.classList.add('hidden');
}
els.errorClose.addEventListener('click', hideError);

/* ---------- 文件接入 ---------- */
function acceptFile(file) {
  if (!file || !isImageMime(file.type)) {
    showError('请选择图片文件');
    return;
  }
  hideError();
  state.file = file;
  state.fileName = stripExt(file.name);
  state.aiBlob = null;
  state.undoStack = [];
  state.redoStack = [];
  state.originalBitmap?.close?.();
  state.originalBitmap = null;

  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  state.sourceUrl = URL.createObjectURL(file);

  els.sourceImg.src = state.sourceUrl;
  els.resultCanvas.classList.add('hidden');
  els.resultCanvas.width = els.resultCanvas.height = 0;
  state.editCanvas.width = state.editCanvas.height = 0;
  els.resultPlaceholder.style.display = '';
  els.editorBar.classList.add('hidden');
  els.timing.textContent = '';
  els.downloadBtn.disabled = true;
  els.processBtn.disabled = false;

  els.dropzone.classList.add('hidden');
  els.workspace.classList.remove('hidden');
}

/* ---------- 主流程：抠图 ---------- */
els.processBtn.addEventListener('click', async () => {
  if (!state.file) return;
  hideError();
  showLoading();
  if (!libPromise) els.firstRunHint.classList.remove('hidden'); // 首次运行提示
  els.processBtn.disabled = true;
  const oldLabel = els.processBtn.textContent;
  els.processBtn.textContent = '处理中…';
  startElapsed();
  const t0 = performance.now();

  try {
    const { removeBackground } = await loadLib();
    els.firstRunHint.classList.add('hidden');
    // 统一先拿透明 PNG；计算设备按用户选择，自动时交给库自行决定
    const modelName = els.model.value === '__custom__' ? els.modelUrl.value.trim() : els.model.value;
    if (!modelName) {
      throw new Error('请填写自定义模型 URL（以 .onnx 结尾）');
    }
    const config = {
      model: modelName,
      output: { type: els.outType.value, format: 'image/png', quality: 0.9 },
      progress: onProgress,
    };
    if (els.device.value !== 'auto') config.device = els.device.value;
    const blob = await removeBackground(state.file, config);
    stopElapsed();
    state.aiBlob = blob;
    state.undoStack = [];
    state.redoStack = [];
    state.originalBitmap?.close?.();
    state.originalBitmap = await createImageBitmap(state.file);
    els.downloadBtn.disabled = false;
    await renderResult();
    els.timing.textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s`;
  } catch (err) {
    console.error(err);
    stopElapsed();
    showError(friendlyError(err));
  } finally {
    hideLoading();
    els.processBtn.disabled = false;
    els.processBtn.textContent = oldLabel;
  }
});

/* ---------- 结果画布（可手动修整） ---------- */
async function renderResult() {
  const bmp = await createImageBitmap(state.aiBlob);
  const ec = state.editCanvas;
  ec.width = bmp.width;
  ec.height = bmp.height;
  ec.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  els.resultCanvas.classList.remove('hidden');
  els.resultPlaceholder.style.display = 'none';
  syncPreviewBg();
  syncEditor();
  refreshDisplay();
}

/* 根据背景类型同步预览底色（CSS 背景：纯色 / 渐变 / 图片 cover）。 */
function syncPreviewBg() {
  const isFg = els.outType.value === 'foreground';
  const want = isFg && (els.applyBg.checked || els.format.value === 'image/jpeg');
  if (!want) {
    els.resultWrap.style.background = '';
    return;
  }
  const kind = els.bgKindSelect.value;
  if (kind === 'color') {
    els.resultWrap.style.background = els.bgColor.value;
  } else if (kind === 'gradient') {
    const f = els.bgGradFrom.value;
    const t = els.bgGradTo.value;
    els.resultWrap.style.background = `linear-gradient(135deg, ${f}, ${t})`;
  } else if (kind === 'image') {
    if (state.bgImageBitmap) {
      els.resultWrap.style.background = `center/cover no-repeat url(${state.bgImageUrl})`;
    } else {
      els.resultWrap.style.background = '';
    }
  } else {
    els.resultWrap.style.background = '';
  }
}

function syncBgKindVisibility() {
  const k = els.bgKindSelect.value;
  els.bgColor.classList.toggle('hidden', k !== 'color');
  els.bgGradFrom.classList.toggle('hidden', k !== 'gradient');
  els.bgGradTo.classList.toggle('hidden', k !== 'gradient');
  els.bgImageBtn.classList.toggle('hidden', k !== 'image');
  els.bgImageName.classList.toggle('hidden', k !== 'image' || !state.bgImageBitmap);
}

function syncEditor() {
  const show = !!state.aiBlob && els.outType.value === 'foreground';
  els.editorBar.classList.toggle('hidden', !show);
  els.fxBar.classList.toggle('hidden', !show);
  els.resultCanvas.classList.toggle('editing', show);
  els.undoBtn.disabled = state.undoStack.length === 0;
  els.redoBtn.disabled = state.redoStack.length === 0;
  if (!show) hideBrushCursor();
}

/* ---------- 贴纸效果（描边 / 投影） ---------- */
function buildSilhouette(src) {
  const s = document.createElement('canvas');
  s.width = src.width;
  s.height = src.height;
  const sc = s.getContext('2d');
  sc.drawImage(src, 0, 0);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = els.strokeColor.value;
  sc.fillRect(0, 0, s.width, s.height);
  return s;
}

/* 用彩色剪影沿圆周多次盖章，得到膨胀描边 */
function drawOutline(ctx, src) {
  const m = Math.min(src.width, src.height);
  const w = (Number(els.strokeWidth.value) / 100) * m;
  if (w < 1) return;
  const sil = buildSilhouette(src);
  const steps = Math.max(20, Math.min(48, Math.ceil(w * 3)));
  for (const r of [w, w * 0.5]) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ctx.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
}

/* 编辑画布 + 装饰效果渲染到目标 ctx（预览与导出共用） */
function renderDecorated(ctx) {
  const src = state.editCanvas;
  const fg = els.outType.value === 'foreground';
  if (fg && els.strokeToggle.checked) drawOutline(ctx, src);
  if (fg && els.shadowToggle.checked) {
    const m = Math.min(src.width, src.height);
    ctx.shadowColor = 'rgba(0, 0, 0, .45)';
    ctx.shadowBlur = (Number(els.shadowSize.value) / 100) * m;
    ctx.shadowOffsetY = ctx.shadowBlur * 0.4;
  }
  ctx.drawImage(src, 0, 0);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/* 刷新预览画布（含装饰） */
function refreshDisplay() {
  if (!state.aiBlob) return;
  const c = els.resultCanvas;
  c.width = state.editCanvas.width;
  c.height = state.editCanvas.height;
  renderDecorated(c.getContext('2d'));
}

/* 涂抹过程中的轻量刷新（跳过描边/投影，保证流畅） */
function refreshDisplayCheap() {
  const c = els.resultCanvas;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(state.editCanvas, 0, 0);
}

/* ---------- 导出合成（格式 + 底色 + 预设尺寸） ---------- */
async function composeFinal() {
  const fmt = els.format.value;
  const isFg = els.outType.value === 'foreground';
  const wantBg = isFg && (els.applyBg.checked || fmt === 'image/jpeg');
  const src = state.editCanvas;

  // 预设尺寸：等比缩放（宽等于预设值，高度按原图比例）
  const preset = Number(els.sizePresetSelect.value) || 0;
  let outW = src.width;
  let outH = src.height;
  if (preset > 0) {
    outW = preset;
    outH = Math.round((src.height / src.width) * preset);
  }

  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext('2d');
  if (wantBg) {
    await paintBackground(
      ctx,
      els.bgKindSelect.value,
      {
        color: els.bgColor.value,
        gradientFrom: els.bgGradFrom.value,
        gradientTo: els.bgGradTo.value,
        imageBitmap: state.bgImageBitmap,
      },
      outW,
      outH
    );
  }
  // 描边 / 阴影：在原尺寸临时画布上完成，最后缩放到目标尺寸（保证描边像素质量）
  if (isFg && (els.strokeToggle.checked || els.shadowToggle.checked)) {
    const tmp = document.createElement('canvas');
    tmp.width = src.width;
    tmp.height = src.height;
    const tctx = tmp.getContext('2d');
    if (els.strokeToggle.checked) drawOutline(tctx, src);
    if (els.shadowToggle.checked) {
      const m = Math.min(src.width, src.height);
      tctx.shadowColor = 'rgba(0, 0, 0, .45)';
      tctx.shadowBlur = (Number(els.shadowSize.value) / 100) * m;
      tctx.shadowOffsetY = tctx.shadowBlur * 0.4;
    }
    tctx.drawImage(src, 0, 0);
    tctx.shadowColor = 'transparent';
    tctx.shadowBlur = 0;
    tctx.shadowOffsetY = 0;
    ctx.drawImage(tmp, 0, 0, outW, outH);
  } else {
    ctx.drawImage(src, 0, 0, outW, outH);
  }
  return new Promise((res) =>
    c.toBlob((b) => res(b), fmt, parseFloat(els.quality.value))
  );
}

/* ---------- 笔刷修整 ---------- */
const brush = { down: false, tool: 'restore', last: null };

function brushRadiusPx() {
  const rect = els.resultCanvas.getBoundingClientRect();
  const scale = rect.width ? state.editCanvas.width / rect.width : 1;
  return (Number(els.brushSize.value) * scale) / 2;
}

function canvasPoint(e) {
  const rect = els.resultCanvas.getBoundingClientRect();
  const c = state.editCanvas;
  return {
    x: (e.clientX - rect.left) * (c.width / rect.width),
    y: (e.clientY - rect.top) * (c.height / rect.height),
  };
}

/* 单个笔刷落点：擦除 = destination-out；恢复 = 贴回原图像素（软边）
 * 返回 command 对象供 pushCommand 记录到撤销栈 */
function dab(ctx, p) {
  const r = brushRadiusPx();
  ctx.save();
  if (brush.tool === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.45, p.x, p.y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const br = Math.ceil(r) + 2;
    const t = document.createElement('canvas');
    t.width = t.height = br * 2;
    const tc = t.getContext('2d');
    tc.drawImage(
      state.originalBitmap,
      p.x - br, p.y - br, br * 2, br * 2,
      0, 0, br * 2, br * 2
    );
    tc.globalCompositeOperation = 'destination-in';
    const g = tc.createRadialGradient(br, br, r * 0.45, br, br, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    tc.fillStyle = g;
    tc.fillRect(0, 0, br * 2, br * 2);
    ctx.drawImage(t, p.x - br, p.y - br);
  }
  ctx.restore();
  return { tool: brush.tool, x: p.x, y: p.y, r };
}

function strokeTo(p) {
  const ctx = state.editCanvas.getContext('2d');
  if (!brush.last) {
    pushCommand(dab(ctx, p));
    brush.last = p;
    return;
  }
  const dx = p.x - brush.last.x;
  const dy = p.y - brush.last.y;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(1, brushRadiusPx() * 0.35);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= n; i++) {
    pushCommand(dab(ctx, { x: brush.last.x + (dx * i) / n, y: brush.last.y + (dy * i) / n }));
  }
  brush.last = p;
}

/* ---------- 撤销 / 重做（命令模式，最大 32 步，O(1) 内存/步） ---------- */
/* 每个 dab 记录一条命令：{ tool, x, y, r }
 * 撤销 = 反向重画：erase→从原图替换；restore→变透明
 * 重做 = 正向重画
 * 内存与图像大小无关，适合 4K+ 大图 */
const MAX_HISTORY = 32;

function pushCommand(cmd) {
  state.undoStack.push(cmd);
  if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
  state.redoStack = []; // 任何新动作清空重做栈
  syncEditor();
}

function applyCommand(ctx, cmd, reverse = false) {
  const tool = reverse ? (cmd.tool === 'erase' ? 'restore' : 'erase') : cmd.tool;
  const r = cmd.r;
  ctx.save();
  if (tool === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createRadialGradient(cmd.x, cmd.y, r * 0.45, cmd.x, cmd.y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cmd.x, cmd.y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const br = Math.ceil(r) + 2;
    const t = document.createElement('canvas');
    t.width = t.height = br * 2;
    const tc = t.getContext('2d');
    tc.drawImage(
      state.originalBitmap,
      cmd.x - br, cmd.y - br, br * 2, br * 2,
      0, 0, br * 2, br * 2
    );
    tc.globalCompositeOperation = 'destination-in';
    const g = tc.createRadialGradient(br, br, r * 0.45, br, br, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    tc.fillStyle = g;
    tc.fillRect(0, 0, br * 2, br * 2);
    ctx.drawImage(t, cmd.x - br, cmd.y - br);
  }
  ctx.restore();
}

function undo() {
  const cmd = state.undoStack.pop();
  if (!cmd) return;
  state.redoStack.push(cmd);
  if (state.redoStack.length > MAX_HISTORY) state.redoStack.shift();
  applyCommand(state.editCanvas.getContext('2d'), cmd, true);
  syncEditor();
  refreshDisplay();
}

function redo() {
  const cmd = state.redoStack.pop();
  if (!cmd) return;
  state.undoStack.push(cmd);
  if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
  applyCommand(state.editCanvas.getContext('2d'), cmd, false);
  syncEditor();
  refreshDisplay();
}

/* ---------- 笔刷光标预览 ---------- */
function updateBrushCursor(e) {
  if (!state.aiBlob || els.outType.value !== 'foreground') return hideBrushCursor();
  const c = els.resultCanvas;
  const wrapRect = els.resultWrap.getBoundingClientRect();
  const rect = c.getBoundingClientRect();
  const d = brushRadiusPx() * 2 * (rect.width / c.width);
  const cur = els.brushCursor;
  cur.style.width = cur.style.height = d + 'px';
  cur.style.left = e.clientX - wrapRect.left + 'px';
  cur.style.top = e.clientY - wrapRect.top + 'px';
  cur.classList.remove('hidden');
}

function hideBrushCursor() {
  els.brushCursor.classList.add('hidden');
}

/* ---------- 下载 ---------- */
els.downloadBtn.addEventListener('click', async () => {
  if (!state.aiBlob) return;
  const blob = await composeFinal();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = cutoutFileName(state.fileName, els.format.value);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

/* ---------- 重置 ---------- */
els.resetBtn.addEventListener('click', () => {
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  if (state.bgImageUrl) URL.revokeObjectURL(state.bgImageUrl);
  state.originalBitmap?.close?.();
  state.bgImageBitmap?.close?.();
  Object.assign(state, {
    file: null,
    fileName: '',
    sourceUrl: null,
    aiBlob: null,
    originalBitmap: null,
    undoStack: [],
    redoStack: [],
    bgImageBitmap: null,
    bgImageUrl: null,
  });
  els.sourceImg.removeAttribute('src');
  els.resultCanvas.classList.add('hidden');
  els.resultCanvas.width = els.resultCanvas.height = 0;
  state.editCanvas.width = state.editCanvas.height = 0;
  els.resultPlaceholder.style.display = '';
  els.editorBar.classList.add('hidden');
  els.fxBar.classList.add('hidden');
  els.workspace.classList.add('hidden');
  els.dropzone.classList.remove('hidden');
  els.processBtn.disabled = true;
  els.downloadBtn.disabled = true;
  els.timing.textContent = '';
  hideLoading();
  hideError();
});

/* ---------- 选项联动 ---------- */
function syncOptionVisibility() {
  els.qualityRow.classList.toggle('hidden', els.format.value === 'image/png');
  els.colorRow.classList.toggle('disabled', els.outType.value !== 'foreground');
  els.bgKindSelect.classList.toggle('hidden', !els.applyBg.checked);
  syncBgKindVisibility();
  // 模型选择：自定义 URL
  const isCustom = els.model.value === '__custom__';
  els.customModelRow.classList.toggle('hidden', !isCustom);
  // 预设尺寸提示
  const preset = Number(els.sizePresetSelect.value) || 0;
  els.sizeHint.textContent = preset ? `导出尺寸 ${preset}×${preset} · 等比` : '保持原图尺寸';
}

els.format.addEventListener('change', () => {
  syncOptionVisibility();
  syncPreviewBg();
});
els.applyBg.addEventListener('change', () => {
  syncOptionVisibility();
  syncPreviewBg();
});
els.bgKindSelect.addEventListener('change', () => {
  syncBgKindVisibility();
  syncPreviewBg();
});
els.bgColor.addEventListener('input', syncPreviewBg);
els.bgGradFrom.addEventListener('input', syncPreviewBg);
els.bgGradTo.addEventListener('input', syncPreviewBg);
els.bgImageBtn.addEventListener('click', () => els.bgImageInput.click());
els.bgImageInput.addEventListener('change', async () => {
  const f = els.bgImageInput.files[0];
  if (!f) return;
  state.bgImageBitmap?.close?.();
  if (state.bgImageUrl) URL.revokeObjectURL(state.bgImageUrl);
  state.bgImageBitmap = await createImageBitmap(f);
  state.bgImageUrl = URL.createObjectURL(f);
  els.bgImageName.textContent = f.name;
  els.bgImageName.title = f.name;
  els.bgImageInput.value = '';
  syncBgKindVisibility();
  syncPreviewBg();
});

els.model.addEventListener('change', syncOptionVisibility);
els.sizePresetSelect.addEventListener('change', syncOptionVisibility);

/* 模型 URL CORS 预检 */
async function probeModelUrl() {
  const url = els.modelUrl.value.trim();
  if (!url) {
    els.probeStatus.textContent = '请先填写 URL';
    return;
  }
  els.probeStatus.textContent = '检测中…';
  els.probeModelBtn.disabled = true;
  try {
    const r = await probeUrl(url, { timeoutMs: 6000 });
    if (r.ok && r.cors) {
      const size = r.contentLength ? ` · ${formatBytes(r.contentLength)}` : '';
      els.probeStatus.textContent = `✓ 可访问${size}`;
      els.probeStatus.style.color = '#34d399';
    } else if (r.ok && !r.cors) {
      els.probeStatus.textContent = `⚠ HTTP ${r.status} 但服务器未返回 CORS 头，浏览器会拦截加载`;
      els.probeStatus.style.color = 'var(--danger)';
    } else if (r.status === 'bad-url') {
      els.probeStatus.textContent = '⚠ URL 格式不正确';
      els.probeStatus.style.color = 'var(--danger)';
    } else if (r.status === 'fetch-failed') {
      els.probeStatus.textContent = `⚠ 无法访问（可能是网络/CORS/不存在）`;
      els.probeStatus.style.color = 'var(--danger)';
    } else {
      els.probeStatus.textContent = `⚠ HTTP ${r.status}`;
      els.probeStatus.style.color = 'var(--danger)';
    }
  } finally {
    els.probeModelBtn.disabled = false;
  }
}
els.probeModelBtn.addEventListener('click', probeModelUrl);
els.modelUrl.addEventListener('input', () => {
  els.probeStatus.textContent = '';
});

els.quality.addEventListener('input', () => {
  els.qualityVal.textContent = Number(els.quality.value).toFixed(2);
});
// outType 影响模型输出内容，切换后需重新点击“开始抠图”
els.outType.addEventListener('change', () => {
  syncOptionVisibility();
  syncPreviewBg();
  syncEditor();
});

syncOptionVisibility();

/* ---------- 上传交互 ---------- */
els.dropzone.addEventListener('click', () => {
  if (state.mode === 'batch') els.batchFileInput.click();
  else els.fileInput.click();
});
els.changeBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => {
  acceptFile(els.fileInput.files[0]);
  els.fileInput.value = ''; // 允许重复选择同一文件
});

for (const ev of ['dragenter', 'dragover']) {
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragging');
  });
}
els.dropzone.addEventListener('dragleave', () =>
  els.dropzone.classList.remove('dragging')
);
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropzone.classList.remove('dragging');
  if (state.mode === 'batch') acceptBatchFiles(e.dataTransfer.files);
  else acceptFile(e.dataTransfer.files[0]);
});

// 阻止浏览器默认打开拖入文件；支持全局 Ctrl+V 粘贴图片
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) =>
    i.type.startsWith('image/')
  );
  if (item) acceptFile(item.getAsFile());
});

/* ---------- 修整工具事件 ---------- */
function setTool(tool) {
  brush.tool = tool;
  els.toolRestore.classList.toggle('active', tool === 'restore');
  els.toolErase.classList.toggle('active', tool === 'erase');
}
els.toolRestore.addEventListener('click', () => setTool('restore'));
els.toolErase.addEventListener('click', () => setTool('erase'));

els.brushSize.addEventListener('input', () => {
  els.brushSizeVal.textContent = els.brushSize.value;
});

els.undoBtn.addEventListener('click', undo);
els.redoBtn.addEventListener('click', redo);
els.resetEditBtn.addEventListener('click', async () => {
  state.undoStack = [];
  state.redoStack = [];
  els.undoBtn.disabled = true;
  els.redoBtn.disabled = true;
  await renderResult();
});

const resultCanvasEl = els.resultCanvas;
resultCanvasEl.addEventListener('pointerdown', (e) => {
  if (!state.aiBlob) return;
  e.preventDefault();
  // 命令模式下：strokeTo 内部 pushCommand 记录每笔；这里不需 pushUndo
  brush.down = true;
  brush.last = null;
  resultCanvasEl.setPointerCapture(e.pointerId);
  strokeTo(canvasPoint(e));
});
resultCanvasEl.addEventListener('pointermove', (e) => {
  updateBrushCursor(e);
  if (brush.down) {
    strokeTo(canvasPoint(e));
    refreshDisplayCheap(); // 涂抹中跳过描边/投影，保证流畅
  }
});
for (const ev of ['pointerup', 'pointercancel']) {
  resultCanvasEl.addEventListener(ev, () => {
    if (brush.down) refreshDisplay(); // 松手后补上描边/投影
    brush.down = false;
    brush.last = null;
  });
}

/* ---------- 全局键盘快捷键 ---------- */
window.addEventListener('keydown', (e) => {
  // 跳过表单元素内的按键（让用户正常输入）
  const tag = (e.target?.tagName || '').toLowerCase();
  const inField = ['input', 'textarea', 'select'].includes(tag);
  // 表单输入保留浏览器原生编辑快捷键（撤销、重做等）
  if (inField) return;

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — 撤销/重做
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (e.key === 'z' || e.key === 'Z') {
      if (!state.aiBlob) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (e.key === 'y' || e.key === 'Y') {
      if (!state.aiBlob) return;
      e.preventDefault();
      redo();
      return;
    }
  }

  // +/- 笔刷大小
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    const v = Math.min(150, Number(els.brushSize.value) + 5);
    els.brushSize.value = v;
    els.brushSizeVal.textContent = v;
    return;
  }
  if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    const v = Math.max(8, Number(els.brushSize.value) - 5);
    els.brushSize.value = v;
    els.brushSizeVal.textContent = v;
    return;
  }
  // 1 / 2 工具切换
  if (e.key === '1') { e.preventDefault(); setTool('restore'); return; }
  if (e.key === '2') { e.preventDefault(); setTool('erase'); return; }
  // B / E 备用别名
  if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setTool('restore'); return; }
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setTool('erase'); return; }
});

/* ============================================================
 * 批量模式
 * ============================================================ */

/* fflate 懒加载 */
let fflatePromise = null;
const loadFflate = () => (fflatePromise ??= import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm'));

function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  els.modeSingle.classList.toggle('active', mode === 'single');
  els.modeBatch.classList.toggle('active', mode === 'batch');
  els.modeSingle.setAttribute('aria-selected', mode === 'single');
  els.modeBatch.setAttribute('aria-selected', mode === 'batch');
  const isBatch = mode === 'batch';
  els.batchPanel.classList.toggle('hidden', !isBatch);
  els.singleActions.classList.toggle('hidden', isBatch);
  els.dropzoneTitle.textContent = isBatch ? '点击选择多张图片' : '点击选择图片';
  els.dropzoneHint.textContent = isBatch
    ? '支持多选 / 拖拽多张 / 粘贴多张（会跳过非图片）'
    : '或将图片拖到这里 / 直接 Ctrl+V 粘贴';
  if (isBatch) renderBatch();
}

/* 批量文件接入（filter 非图片、限大小为安全值） */
function acceptBatchFiles(files) {
  const list = [...files].filter(isImageMime);
  if (list.length === 0) {
    showError('未选择有效图片');
    return;
  }
  const { queue, added } = enqueueMany(state.batch, list);
  state.batch = queue;
  if (added.length === 0) showError('所选文件已在队列中');
  renderBatch();
}

function renderBatch() {
  const q = state.batch;
  els.batchStats.textContent = `共 ${q.items.length} · 待处理 ${queueStats(q).pending} · 失败 ${queueStats(q).failed}`;
  els.batchBarFill.style.width = overallProgress(q) + '%';
  const canStart = !q.active && q.items.some((it) => it.status === STATUS.PENDING);
  els.batchStartBtn.disabled = !canStart;
  const canDownload = !q.active && q.items.some((it) => it.status === STATUS.DONE);
  els.batchDownloadBtn.disabled = !canDownload;

  els.batchList.innerHTML = q.items
    .map((it) => {
      const cls = it.status;
      const pct = it.status === STATUS.PROCESSING ? Math.min(100, Math.round(it.progress)) : (it.status === STATUS.DONE ? 100 : 0);
      const id = escapeHtml(it.id);
      const fileName = escapeHtml(it.fileName);
      const error = escapeHtml(it.error || '');
      const err = it.status === STATUS.FAILED ? `<span class="err" title="${error}">${error}</span>` : '';
      const retryBtn = it.status === STATUS.FAILED
        ? `<button class="btn small ghost" data-act="retry" title="重试">↻</button>` : '';
      const delBtn = it.status !== STATUS.PROCESSING
        ? `<button class="btn small ghost" data-act="remove" title="删除">✕</button>` : '';
      return `<li data-id="${id}">
        <span class="name" title="${fileName}">${fileName}</span>
        <div class="mini-bar"><div style="width:${pct}%"></div></div>
        <span class="badge ${cls}">${labelOf(it.status)}</span>
        ${err}
        ${retryBtn}${delBtn}
      </li>`;
    })
    .join('');
}

function labelOf(s) {
  return { pending: '待处理', processing: '处理中', done: '完成', failed: '失败' }[s] || s;
}

/* 批量主流程：顺序处理（并发容易 OOM），单张失败不影响其他 */
let batchTimer = null;
async function startBatch() {
  if (state.batch.active) return;
  if (!state.batch.items.length) return;
  if (!state.batch.items.some((it) => it.status === STATUS.PENDING)) return;

  hideError();
  state.batch = { ...state.batch, active: true, cancelled: false };
  els.batchStartBtn.disabled = true;
  const t0 = performance.now();
  batchTimer = setInterval(() => {
    els.batchElapsed.textContent = formatElapsed(performance.now() - t0);
  }, 200);
  renderBatch();

  try {
    const { removeBackground } = await loadLib();
    while (true) {
      const item = state.batch.items.find((it) => it.status === STATUS.PENDING);
      if (!item || state.batch.cancelled) break;
      state.batch = updateItem(state.batch, item.id, { status: STATUS.PROCESSING, progress: 0, error: null });
      renderBatch();
      try {
        const modelName = els.model.value === '__custom__' ? els.modelUrl.value.trim() : els.model.value;
        if (!modelName) throw new Error('请填写自定义模型 URL');
        const config = {
          model: modelName,
          output: { type: 'foreground', format: 'image/png', quality: 0.9 },
          progress: (key, cur, total) => {
            const pct = percentOf(cur, total) ?? 0;
            state.batch = updateItem(state.batch, item.id, { progress: pct });
            els.batchBarFill.style.width = overallProgress(state.batch) + '%';
          },
        };
        if (els.device.value !== 'auto') config.device = els.device.value;
        const blob = await removeBackground(item.file, config);
        // 合成输出格式（保持 UI 设置）
        const finalBlob = await composeForBatch(blob);
        state.batch = updateItem(state.batch, item.id, { status: STATUS.DONE, progress: 100, blob: finalBlob });
      } catch (e) {
        console.error(e);
        state.batch = updateItem(state.batch, item.id, { status: STATUS.FAILED, error: friendlyError(e) });
      }
      renderBatch();
    }
  } catch (e) {
    showError(friendlyError(e));
  } finally {
    clearInterval(batchTimer);
    batchTimer = null;
    state.batch = { ...state.batch, active: false };
    renderBatch();
  }
}

/* 批量项合成（参照 composeFinal，但走一次性临时 canvas） */
async function composeForBatch(blob) {
  const fmt = els.format.value;
  const wantColor = els.applyBg.checked || fmt === 'image/jpeg';
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  if (wantColor) {
    ctx.fillStyle = els.bgColor.value;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return new Promise((res) => c.toBlob((b) => res(b), fmt, parseFloat(els.quality.value)));
}

/* zip 打包下载 */
async function downloadBatchAsZip() {
  const done = state.batch.items.filter((it) => it.status === STATUS.DONE && it.blob);
  if (done.length === 0) return;
  const { zip } = await loadFflate();
  const used = new Set();
  const entries = {};
  for (const it of done) {
    const buf = new Uint8Array(await it.blob.arrayBuffer());
    entries[uniqueZipName(used, cutoutFileName(it.fileName, it.blob.type))] = buf;
  }
  const zipped = zip(entries, { level: 6 });
  const blob = new Blob([zipped], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cutouts-${Date.now()}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- 批量事件绑定 ---------- */
els.modeSingle.addEventListener('click', () => setMode('single'));
els.modeBatch.addEventListener('click', () => setMode('batch'));
els.batchAddBtn.addEventListener('click', () => els.batchFileInput.click());
els.batchFileInput.addEventListener('change', () => {
  acceptBatchFiles(els.batchFileInput.files);
  els.batchFileInput.value = '';
});
els.batchStartBtn.addEventListener('click', startBatch);
els.batchDownloadBtn.addEventListener('click', downloadBatchAsZip);
els.batchClearBtn.addEventListener('click', () => {
  state.batch = clearFinished(state.batch);
  renderBatch();
});
/* 批量列表事件委托：重试 / 删除 */
els.batchList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const li = btn.closest('li');
  if (!li) return;
  const id = li.dataset.id;
  if (btn.dataset.act === 'remove') {
    state.batch = removeItem(state.batch, id);
    renderBatch();
  } else if (btn.dataset.act === 'retry') {
    state.batch = updateItem(state.batch, id, { status: STATUS.PENDING, error: null });
    if (!state.batch.active) startBatch();
    else renderBatch();
  }
});

/* 批量模式下粘贴接入多文件（单图模式走原 paste 逻辑） */
window.addEventListener('paste', (e) => {
  if (state.mode !== 'batch') return;
  const items = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/'));
  if (items.length === 0) return;
  acceptBatchFiles(items.map((i) => i.getAsFile()).filter(Boolean));
});
resultCanvasEl.addEventListener('pointerleave', hideBrushCursor);

/* ---------- 贴纸效果事件 ---------- */
els.strokeWidth.addEventListener('input', () => {
  els.strokeWidthVal.textContent = els.strokeWidth.value + '%';
  refreshDisplay();
});
els.shadowSize.addEventListener('input', () => {
  els.shadowSizeVal.textContent = els.shadowSize.value + '%';
  refreshDisplay();
});
els.strokeToggle.addEventListener('change', refreshDisplay);
els.shadowToggle.addEventListener('change', refreshDisplay);
els.strokeColor.addEventListener('input', refreshDisplay);

/* ---------- 缓存管理 ---------- */
/* 使用 storage.estimate() + caches.keys() 读取缓存状态。
 * Service Worker 缓存主要存 ONNX/WASM；浏览器磁盘缓存存所有 fetch 过的资源（包括 JS/HTML）。
 * 注意：浏览器磁盘缓存由浏览器策略管理，本工具只能管理 SW 缓存（caches.delete）+ nuke 存储估算。 */

async function refreshCacheInfo() {
  let usage = null;
  let quota = null;
  if (navigator.storage?.estimate) {
    try {
      const e = await navigator.storage.estimate();
      usage = e.usage || 0;
      quota = e.quota || 0;
    } catch {}
  }
  els.cacheUsage.textContent = usage !== null ? formatBytes(usage) : '不可用';
  if (quota > 0) {
    const pct = ((usage / quota) * 100).toFixed(1);
    els.cacheQuota.textContent = `${formatBytes(usage)} / ${formatBytes(quota)} (${pct}%)`;
  } else {
    els.cacheQuota.textContent = '不可用';
  }
  // SW 缓存列表
  try {
    const names = (await caches.keys()).filter((n) => n.startsWith('model-'));
    if (names.length === 0) {
      els.cacheStatus.textContent = '未缓存（首次扣图后会自动下载）';
    } else {
      // 统计 model 缓存中所有响应的字节数
      let bytes = 0;
      for (const n of names) {
        const cache = await caches.open(n);
        const keys = await cache.keys();
        for (const k of keys) {
          const r = await cache.match(k);
          if (!r) continue;
          const buf = await r.clone().arrayBuffer().catch(() => null);
          if (buf) bytes += buf.byteLength;
        }
      }
      els.cacheStatus.textContent = `已缓存 · ${formatBytes(bytes)}`;
    }
  } catch (e) {
    els.cacheStatus.textContent = '检测失败';
  }
}

/* 预下载选中模型：走库触发 ONNX 文件下载，由 SW 缓存。 */
async function prefetchModel() {
  const modelName = els.model.value === '__custom__' ? els.modelUrl.value.trim() : els.model.value;
  if (!modelName) {
    showError('请先选择/填写模型');
    return;
  }
  els.prefetchBtn.disabled = true;
  els.prefetchBtn.textContent = '下载中…';
  hideError();
  try {
    const { removeBackground } = await loadLib();
    // 1x1 透明 PNG 触发库加载模型；走一次扣图就能把 ONNX/WASM 全部预下载到 SW
    const tinyPng = new Uint8Array([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,
      0x89,0x00,0x00,0x00,0x0d,0x49,0x44,0x41,0x54,0x78,0x9c,0x63,0x00,0x01,0x00,0x00,
      0x05,0x00,0x01,0x0d,0x0a,0x2d,0xb4,0x00,0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,
      0x42,0x60,0x82,
    ]);
    const blob = new Blob([tinyPng], { type: 'image/png' });
    const config = {
      model: modelName,
      output: { type: 'foreground', format: 'image/png', quality: 0.9 },
      progress: () => {},
    };
    if (els.device.value !== 'auto') config.device = els.device.value;
    await removeBackground(blob, config).catch(() => {});
    showError('预下载完成 · 模型已缓存');
    els.errorText.style.color = '#34d399';
    await refreshCacheInfo();
  } catch (e) {
    showError('预下载失败：' + friendlyError(e));
  } finally {
    els.prefetchBtn.disabled = false;
    els.prefetchBtn.textContent = '预下载选中模型';
    setTimeout(() => { els.errorText.style.color = ''; }, 1500);
  }
}

/* 清理：删除所有 model-* 缓存 + 注销 SW（让浏览器重新初始化） */
async function clearModelCache() {
  if (!confirm('确认清理所有模型缓存？清理后下次扣图会重新下载。')) return;
  try {
    const names = await caches.keys();
    for (const n of names) {
      if (n.startsWith('model-') || n.startsWith('shell-')) await caches.delete(n);
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    showError('清理完成 · 请刷新页面');
    els.errorText.style.color = '#34d399';
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    showError('清理失败：' + friendlyError(e));
  }
}

els.prefetchBtn.addEventListener('click', prefetchModel);
els.clearCacheBtn.addEventListener('click', clearModelCache);

// 页面加载时 + 随时可点 details 重新检查
refreshCacheInfo();
// details 是 cacheStatus 的三层祖辈 (span → div.cache-row → div.cache-info → details)
const cacheDetails = els.cacheStatus.parentElement.parentElement.parentElement;
if (cacheDetails && cacheDetails.tagName === 'DETAILS') {
  cacheDetails.addEventListener('toggle', refreshCacheInfo);
}