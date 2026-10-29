import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeUrl } from '../../packages/backend/src/lib/url.ts';
import type { Store, Entry } from './types.ts';
export const DATA_DIR = path.resolve(import.meta.dirname, '../../.data/local-mvp');
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const keyFor = (url: string) => { const key = normalizeUrl(url); if (!key) throw Error('无效文章地址'); return key; };
export const idFor = (url: string) => `live-${hash(keyFor(url)).slice(0, 16)}`;
export async function loadStore(dir = DATA_DIR): Promise<Store> {
  try { const data = JSON.parse(await fs.readFile(path.join(dir, 'store.json'), 'utf8')); if (data.version !== 1 || !data.entries || !data.runs) throw Error('存储格式不支持'); return data; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return { version: 1, entries: {}, sources: {}, runs: [] }; }
}
export async function atomicJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
  await fs.rename(temporary, file);
}
export async function saveStore(store: Store, dir = DATA_DIR) { await atomicJson(path.join(dir, 'store.json'), store); }
export async function withLock<T>(fn: () => Promise<T>, dir = DATA_DIR): Promise<T> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'run.lock');
  const lock = await fs.open(file, 'wx'); // 定时采集与手动更新不能同时写同一个存储。
  try { await lock.writeFile(String(process.pid)); return await fn(); }
  finally { await lock.close(); await fs.unlink(file); }
}
export function seedBaseline(store: Store, items: { id: string; url: string; sourceId: string; sourceName: string; title: string; publishedAt: string }[], now: string) {
  for (const a of items) {
    const key = keyFor(a.url);
    if (store.entries[key]) continue;
    store.entries[key] = { id: a.id, key, url: a.url, sourceId: a.sourceId, sourceName: a.sourceName, originalTitle: a.title,
      excerpt: '', publishedAt: a.publishedAt, firstSeenAt: now, lastSeenAt: now, status: 'baseline',
      bodyHash: null, bodyChars: 0, bodyFile: null, checkedAt: null, pageDate: null, error: null };
  }
}
export function upsert(store: Store, input: Pick<Entry, 'url' | 'sourceId' | 'sourceName' | 'originalTitle' | 'excerpt' | 'publishedAt'>, now: string) {
  const key = keyFor(input.url), existing = store.entries[key];
  if (existing) { existing.lastSeenAt = now; return { entry: existing, inserted: false }; }
  const entry: Entry = { ...input, id: idFor(key), key, firstSeenAt: now, lastSeenAt: now, status: 'pending',
    bodyHash: null, bodyChars: 0, bodyFile: null, checkedAt: null, pageDate: null, error: null };
  store.entries[key] = entry; return { entry, inserted: true };
}
