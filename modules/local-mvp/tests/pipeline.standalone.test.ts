import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { idFor, loadStore, saveStore, upsert, hash, seedBaseline, withLock } from '../store.ts';
import { dateState, officialSummary, fetchPublic, bodyQueue } from '../collect.ts';
import { applyEdits } from '../publish.ts';
import type { Edit, Store, Entry } from '../types.ts';
const empty = (): Store => ({ version: 1, entries: {}, sources: {}, runs: [] });
const when = '2026-10-29T08:00:00.000Z';
const originOf = (entry: Entry) => entry.publication?.origin;
const candidate = { url: 'http://www.example.com/article/?utm_source=test', sourceId: 'source-001', sourceName: 'Amazon Ads',
  originalTitle: '广告平台推出新的商品推广工具', excerpt: '广告主可以使用新的工具了解投放变化，具体地区和资格以原文为准。', publishedAt: '2026-10-02' };
test('重启与重复采集不新增重复网址，也不丢掉已保存的内容', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amazon-hot-'));
  const first = empty(), a = upsert(first, candidate, when); assert.equal(a.inserted, true);
  const b = upsert(first, { ...candidate, url: 'https://example.com/article?utm_campaign=another#part' }, when);
  assert.equal(b.inserted, false); assert.equal(a.entry.id, b.entry.id);
  await saveStore(first, dir); const restored = await loadStore(dir);
  assert.equal(Object.keys(restored.entries).length, 1);
  assert.equal(idFor(candidate.url), idFor(b.entry.url));
  await fs.unlink(path.join(dir, 'store.json')); await fs.rmdir(dir);
});
test('日历日期保持10月2日，未来文章延后，过期日期不伪装成新消息', () => {
  const store = empty(), { entry } = upsert(store, candidate, when);
  entry.bodyHash = hash('真实正文'); officialSummary(entry, when);
  assert.equal(entry.publication?.publishedAt, '2026-10-02');
  assert.equal(dateState('2026-11-03T15:39:00Z', when), 'future');
  assert.equal(dateState('2025-10-02', when), 'old');
});
test('缺正文、英文摘要、材料报错都不能自动发布；官方摘要不伪装成模型结果', () => {
  const { entry } = upsert(empty(), candidate, when); officialSummary(entry, when); assert.equal(entry.publication, undefined);
  entry.bodyHash = hash('body'); entry.error = 'HTTP 403'; officialSummary(entry, when); assert.equal(entry.publication, undefined);
  entry.error = null; entry.excerpt = 'An English teaser'; officialSummary(entry, when); assert.equal(entry.publication, undefined);
  entry.excerpt = candidate.excerpt; officialSummary(entry, when); assert.equal(originOf(entry), 'publisher-summary');
});
test('整理绑定正文版本，不能伪造用户标签或覆盖原48篇', () => {
  const s = empty(), { entry } = upsert(s, candidate, when); entry.bodyHash = hash('body');
  const edit: Edit = { id: entry.id, evidenceHash: 'wrong', decision: 'publish', title: '教程', summary: '有用内容', points: ['有原文依据'],
    features: { sections: ['教程（新人入门与进阶）'] }, materialNote: '机构经验，非效果保证', reviewedAt: when, reviewedBy: 'Agent' };
  assert.throws(() => applyEdits(s, [edit]), /正文版本/);
  edit.evidenceHash = entry.bodyHash; applyEdits(s, [edit]); assert.equal(entry.publication?.origin, 'agent-reviewed');
  const original = empty(); seedBaseline(original, [{ ...candidate, id: 'article-001', title: '用户保留' }], when);
  const base = Object.values(original.entries)[0]; base.bodyHash = entry.bodyHash;
  assert.throws(() => applyEdits(original, [{ ...edit, id: base.id }]), /不能覆盖/);
});
test('并行更新互斥，失败后仍可读取原快照，释放锁后可以再次更新', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amazon-hot-lock-'));
  await saveStore(empty(), dir);
  await assert.rejects(withLock(async () => { await assert.rejects(withLock(async () => {}, dir)); throw Error('模拟上游失败'); }, dir), /模拟上游/);
  assert.deepEqual(await loadStore(dir), empty());
  await withLock(async () => {}, dir);
  await fs.unlink(path.join(dir, 'store.json')); await fs.rmdir(dir);
});
test('固定信源不允许转向其它域名，不访问内网或执行来源给出的命令', async () => {
  await assert.rejects(fetchPublic('http://127.0.0.1/secrets', { id: 'x', name: 'x', kind: 'rss', url: 'https://example.com/feed', host: 'example.com', language: 'en', bodyLimit: 1 }), /未配置/);
});
test('正文任务不依赖当前订阅；窗口滚动保留旧教程，新任务先于失败重试', () => {
  const s = empty();
  const failed = upsert(s, { ...candidate, url: 'https://example.com/failure' }, when).entry;
  failed.status = 'material_error'; failed.checkedAt = when;
  const pending = upsert(s, { ...candidate, url: 'https://example.com/no-longer-in-feed' }, when).entry;
  const published = upsert(s, { ...candidate, url: 'https://example.com/saved-tutorial', publishedAt: '2025-01-01' }, when).entry;
  published.status = 'published';
  assert.deepEqual(bodyQueue(s, candidate.sourceId, when).map(e => e.id), [pending.id, failed.id]);
  assert.equal(bodyQueue(s, candidate.sourceId, '2027-01-01').length, 0);
  assert.equal(pending.status, 'old'); assert.equal(published.status, 'published');
});
