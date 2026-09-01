/* 批量队列 — 状态机（纯函数 + 不可变更新）。
 * 单图模式不引入；批量模式通过 createQueue 管理一组文件。
 */

let _seq = 0;
const nextId = () => `q${Date.now().toString(36)}${(++_seq).toString(36)}`;

export const STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
});

/* 新建空队列 */
export function createQueue() {
  return {
    items: [],
    active: false,
    cancelled: false,
  };
}

/* 入队一个文件项（pending）。已存在同名则返回原项，不重复添加。 */
export function enqueue(queue, file) {
  const fileName = file?.name || 'image';
  if (queue.items.some((it) => it.fileName === fileName && it.file?.size === file?.size)) {
    return { queue, item: null, added: false };
  }
  const item = {
    id: nextId(),
    file,
    fileName,
    status: STATUS.PENDING,
    progress: 0,
    blob: null,
    error: null,
  };
  return { queue: { ...queue, items: [...queue.items, item] }, item, added: true };
}

/* 批量入队 */
export function enqueueMany(queue, files) {
  let next = queue;
  const added = [];
  for (const f of files) {
    const r = enqueue(next, f);
    next = r.queue;
    if (r.added) added.push(r.item);
  }
  return { queue: next, added };
}

/* 不可变更新单项 */
export function updateItem(queue, id, patch) {
  return {
    ...queue,
    items: queue.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
  };
}

/* 不可变移除单项 */
export function removeItem(queue, id) {
  return { ...queue, items: queue.items.filter((it) => it.id !== id) };
}

/* 清空已完成的项 */
export function clearFinished(queue) {
  return {
    ...queue,
    items: queue.items.filter((it) => it.status !== STATUS.DONE),
  };
}

/* 计算总体进度（按状态权重）：processing=50% 占位 + done=100% */
export function overallProgress(queue) {
  if (queue.items.length === 0) return 0;
  const weights = {
    [STATUS.PENDING]: 0,
    [STATUS.PROCESSING]: 50,
    [STATUS.DONE]: 100,
    [STATUS.FAILED]: 100,
  };
  const sum = queue.items.reduce((acc, it) => {
    const w = weights[it.status] ?? 0;
    const sub = it.status === STATUS.PROCESSING ? Math.min(50, it.progress / 2) : 0;
    return acc + w + sub;
  }, 0);
  return Math.round(sum / queue.items.length);
}

/* 统计各状态数量 */
export function stats(queue) {
  const r = { total: queue.items.length, pending: 0, processing: 0, done: 0, failed: 0 };
  for (const it of queue.items) r[it.status]++;
  return r;
}

/* 下一个待处理项（pending 优先）；不存在返回 null */
export function nextPending(queue) {
  return queue.items.find((it) => it.status === STATUS.PENDING) || null;
}

/* 解决 zip 内文件名冲突：foo.png → foo (1).png */
export function uniqueZipName(used, baseName) {
  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  let name = baseName;
  let n = 1;
  while (used.has(name)) {
    name = `${stem} (${n})${ext}`;
    n++;
  }
  used.add(name);
  return name;
}