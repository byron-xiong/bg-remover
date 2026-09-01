#!/usr/bin/env node
/* 语法 lint：递归检查 .js / .mjs 文件，排除 node_modules / .git / desktop/build
 * 用法：node scripts/lint.mjs */

import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
const SKIP = new Set(['node_modules', '.git', 'desktop', 'tests', 'docs']);
const EXTS = new Set(['.js', '.mjs']);

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) out.push(...(await walk(p)));
    else if (EXTS.has(extname(name))) out.push(p);
  }
  return out;
}

const files = await walk(ROOT);
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.error(`✖ ${f}\n${r.stderr.trim()}`);
  }
}
if (bad === 0) console.log(`✓ ${files.length} files OK`);
process.exit(bad === 0 ? 0 : 1);