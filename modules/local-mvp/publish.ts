import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SECTIONS, feed } from '../../industry/curation.ts';
import type { Article } from '../../industry/curation.ts';
import { atomicJson, DATA_DIR, hash, keyFor, loadStore, saveStore, withLock } from './store.ts';
import { dateState } from './collect.ts';
import type { Edit, Store } from './types.ts';
export const SNAPSHOT = new URL('../../site/collected-content.json', import.meta.url);
export const EDITS = new URL('../../site/editorial.json', import.meta.url);
export function applyEdits(store: Store, edits: Edit[]) {
  for (const edit of edits) {
    const entry = Object.values(store.entries).find(e => e.id === edit.id);
    if (!entry || !entry.bodyHash || entry.bodyHash !== edit.evidenceHash) throw Error(`整理与正文版本不符 ${edit.id}`);
    if (entry.status === 'baseline') throw Error('不能覆盖用户原48篇标记');
    if (edit.reviewedBy !== 'Agent') throw Error('不得冒充用户判断');
    if (!edit.materialNote?.trim()) throw Error('缺少材料说明');
    if (edit.decision === 'exclude') { entry.status = 'excluded'; delete entry.publication; continue; }
    if (entry.error || !entry.publishedAt || dateState(entry.publishedAt, edit.reviewedAt) !== 'pending') throw Error(`日期或材料未核实 ${edit.id}`);
    if (!edit.title || !edit.summary || !edit.points?.length || !edit.features?.sections.length ||
      edit.features.sections.some(s => !SECTIONS.includes(s))) throw Error(`整理字段不完整 ${edit.id}`);
    entry.publication = { id: entry.id, title: edit.title, summary: edit.summary, points: edit.points,
      sourceName: entry.sourceName, url: entry.url, publishedAt: entry.publishedAt.slice(0, 10), updatedAt: null,
      materialNote: edit.materialNote, features: edit.features, collectionApproved: true,
      origin: 'agent-reviewed', evidenceHash: entry.bodyHash, reviewedAt: edit.reviewedAt };
    entry.status = 'published';
  }
}
export async function publishSnapshot(dir = DATA_DIR) {
  return withLock(async () => {
    const store = await loadStore(dir);
    const edits: Edit[] = JSON.parse(await fs.readFile(EDITS, 'utf8'));
    const known = new Set(Object.values(store.entries).map(e => e.id));
    applyEdits(store, edits.filter(e => known.has(e.id))); await saveStore(store, dir);
    const items = Object.values(store.entries).filter(e => e.status === 'published' && e.publication).map(e => ({ ...e.publication!, sourceId: e.sourceId, addedAt: e.firstSeenAt }));
    const counts = Object.values(store.entries).reduce<Record<string, number>>((out, e) => { out[e.status] = (out[e.status] || 0) + 1; return out; }, {});
    const last = store.runs.at(-1);
    const snapshot = { updatedAt: last?.finishedAt || null, items,
      collection: { enabled: true, intervalMinutes: 120, lastRun: last || null, counts, modelCalls: 0,
        explanation: '官方现成中文摘要在正文与日期通过后收录；英文文章等待Agent整理。没有调用独立模型API。' } };
    await atomicJson(fileURLToPath(SNAPSHOT), snapshot); return snapshot;
  }, dir);
}
export async function buildContent() {
  const pool = JSON.parse(await fs.readFile(new URL('../../docs/收录池.json', import.meta.url), 'utf8'));
  const annotations = JSON.parse(await fs.readFile(new URL('../../industry/preview-annotations.json', import.meta.url), 'utf8'));
  if (pool.items.length !== pool.total) throw Error('收录数量不一致');
  const baseline = pool.items.map((a: Article) => {
    const found = annotations.items.filter((x: { number: string }) => `article-${x.number}` === a.id);
    if (found.length !== 1 || !a.collectionApproved) throw Error(`缺少唯一标注/许可 ${a.id}`);
    const { number, ...features } = found[0]; return { ...a, features, origin: 'user-reviewed' };
  });
  let snapshot = { items: [] as Article[], updatedAt: null, collection: null };
  try { snapshot = JSON.parse(await fs.readFile(SNAPSHOT, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const seen = new Set(baseline.map((a: Article) => keyFor(a.url)));
  const additions = snapshot.items.filter(a => { const key = keyFor(a.url); if (seen.has(key)) return false; seen.add(key); return true; });
  const items: Article[] = [...baseline, ...additions];
  for (const a of items) {
    if (!a.collectionApproved || !a.features.sections.length || a.features.sections.some(s => !SECTIONS.includes(s))) throw Error(`文章缺少有效栏目 ${a.id}`);
    if (!/^https?:\/\//.test(a.url) || !a.publishedAt) throw Error(`无效链接或日期 ${a.id}`);
  }
  return { reviewedAt: '2026-10-29', updatedAt: snapshot.updatedAt, total: items.length, reviewedTotal: pool.total,
    sections: SECTIONS, revision: hash(JSON.stringify(items)), collection: snapshot.collection, items,
    groupedRows: feed(items).groups.length };
}
