import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQueue,
  enqueue,
  enqueueMany,
  updateItem,
  removeItem,
  clearFinished,
  overallProgress,
  stats,
  nextPending,
  uniqueZipName,
  STATUS,
} from '../src/queue.js';

const fakeFile = (name = 'a.png', size = 1024) => ({
  name,
  size,
  type: 'image/png',
});

describe('createQueue', () => {
  it('starts empty and inactive', () => {
    const q = createQueue();
    assert.equal(q.items.length, 0);
    assert.equal(q.active, false);
    assert.equal(q.cancelled, false);
  });
});

describe('enqueue / enqueueMany', () => {
  it('adds a single file', () => {
    const { queue, added } = enqueue(createQueue(), fakeFile('a.png'));
    assert.equal(added, true);
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].status, STATUS.PENDING);
  });
  it('rejects duplicate (same name + size)', () => {
    const f = fakeFile('a.png', 100);
    const { queue: q1 } = enqueue(createQueue(), f);
    const { queue: q2, added } = enqueue(q1, f);
    assert.equal(added, false);
    assert.equal(q2.items.length, 1);
  });
  it('keeps immutability', () => {
    const q0 = createQueue();
    const { queue: q1 } = enqueue(q0, fakeFile());
    assert.notEqual(q0, q1);
    assert.equal(q0.items.length, 0);
    assert.equal(q1.items.length, 1);
  });
  it('batch enqueue counts only added', () => {
    const { queue, added } = enqueueMany(createQueue(), [
      fakeFile('a.png'),
      fakeFile('b.png'),
      fakeFile('a.png'), // dup
    ]);
    assert.equal(added.length, 2);
    assert.equal(queue.items.length, 2);
  });
});

describe('updateItem / removeItem / clearFinished', () => {
  it('updates by id only', () => {
    const { queue: q1, item } = enqueue(createQueue(), fakeFile('a.png'));
    const q2 = updateItem(q1, item.id, { status: STATUS.PROCESSING, progress: 30 });
    assert.equal(q2.items[0].status, STATUS.PROCESSING);
    assert.equal(q1.items[0].status, STATUS.PENDING); // 原队列未变
  });
  it('removes by id', () => {
    const { queue: q1, item } = enqueue(createQueue(), fakeFile());
    const q2 = removeItem(q1, item.id);
    assert.equal(q2.items.length, 0);
    assert.equal(q1.items.length, 1);
  });
  it('clearFinished keeps pending/failed', () => {
    let q = createQueue();
    const { queue: q1, item: i1 } = enqueue(q, fakeFile('a.png'));
    q = q1;
    const { queue: q2, item: i2 } = enqueue(q, fakeFile('b.png'));
    q = q2;
    q = updateItem(q, i1.id, { status: STATUS.DONE });
    q = updateItem(q, i2.id, { status: STATUS.FAILED, error: 'oops' });
    const cleared = clearFinished(q);
    assert.equal(cleared.items.length, 1);
    assert.equal(cleared.items[0].status, STATUS.FAILED);
  });
});

describe('overallProgress', () => {
  it('returns 0 on empty queue', () => {
    assert.equal(overallProgress(createQueue()), 0);
  });
  it('returns 0 when all pending', () => {
    const { queue } = enqueueMany(createQueue(), [fakeFile('a'), fakeFile('b')]);
    assert.equal(overallProgress(queue), 0);
  });
  it('returns 100 when all done', () => {
    let q = createQueue();
    const { queue: q1, item: i1 } = enqueue(q, fakeFile('a'));
    q = updateItem(q1, i1.id, { status: STATUS.DONE });
    const { queue: q2, item: i2 } = enqueue(q, fakeFile('b'));
    q = updateItem(q2, i2.id, { status: STATUS.DONE });
    assert.equal(overallProgress(q), 100);
  });
  it('handles partial progress', () => {
    const { queue: q1, item: i1 } = enqueue(createQueue(), fakeFile('a'));
    const q2 = updateItem(q1, i1.id, { status: STATUS.PROCESSING, progress: 40 });
    const { queue: q3, item: i2 } = enqueue(q2, fakeFile('b'));
    assert.equal(overallProgress(q3), 35); // ((50+20) + 0) / 2
  });
});

describe('stats', () => {
  it('counts by status', () => {
    let q = createQueue();
    const { queue: q1, item: i1 } = enqueue(q, fakeFile('a'));
    q = q1;
    const { queue: q2, item: i2 } = enqueue(q, fakeFile('b'));
    q = updateItem(q2, i1.id, { status: STATUS.DONE });
    q = updateItem(q, i2.id, { status: STATUS.FAILED });
    const s = stats(q);
    assert.deepEqual(s, { total: 2, pending: 0, processing: 0, done: 1, failed: 1 });
  });
});

describe('nextPending', () => {
  it('returns first pending', () => {
    const { queue: q1, item: i1 } = enqueue(createQueue(), fakeFile('a'));
    const { queue: q2, item: i2 } = enqueue(q1, fakeFile('b'));
    assert.equal(nextPending(q2).id, i1.id);
    const q3 = updateItem(q2, i1.id, { status: STATUS.DONE });
    assert.equal(nextPending(q3).id, i2.id);
  });
  it('returns null when none pending', () => {
    const { queue: q1, item } = enqueue(createQueue(), fakeFile());
    const q2 = updateItem(q1, item.id, { status: STATUS.DONE });
    assert.equal(nextPending(q2), null);
  });
});

describe('uniqueZipName', () => {
  it('returns base name when not used', () => {
    const used = new Set();
    assert.equal(uniqueZipName(used, 'foo.png'), 'foo.png');
    assert.equal(used.has('foo.png'), true);
  });
  it('appends (n) on collision', () => {
    const used = new Set(['foo.png']);
    assert.equal(uniqueZipName(used, 'foo.png'), 'foo (1).png');
    assert.equal(uniqueZipName(used, 'foo.png'), 'foo (2).png');
  });
  it('handles files without extension', () => {
    const used = new Set();
    assert.equal(uniqueZipName(used, 'README'), 'README');
    const used2 = new Set(['README']);
    assert.equal(uniqueZipName(used2, 'README'), 'README (1)');
  });
});