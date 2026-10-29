import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { feed, priority } from './curation.ts';
import type { Article, Features } from './curation.ts';
const item = (id: string, features: Partial<Features> = {}, date = '2026-10-29'): Article => ({
  id, title: id, summary: '', points: [], url: 'https://example.com/', sourceName: 'source',
  publishedAt: date, updatedAt: null, materialNote: '', collectionApproved: true,
  features: { sections: ['教程（新人入门与进阶）'], ...features },
});
test('降优先级仍保留收录；有推广入口不自动等于以推广为主', () => {
  const a = item('vendor'), b = item('promotion', { promotionLed: true }), c = item('tech', { softwareOnly: true });
  assert.equal(feed([a, b, c]).matchingArticles, 3);
  assert.ok(priority(a).tier > priority(b).tier);
  assert.equal(priority(c).tier, 0);
  assert.equal(priority(item('mcp', { aiAdsWorkflow: true })).tier, 2);
});
test('推荐看偏好；原文时间排序不冒充今日热点', () => {
  const old = item('practice', { adPractice: true }, '2025-01-01'), recent = item('news');
  assert.equal(feed([recent, old]).groups[0].article.id, 'practice');
  assert.equal(feed([recent, old], { sort: 'date' }).groups[0].article.id, 'news');
  assert.equal(old.publishedAt, '2025-01-01');
});
test('同档错开相邻品类，不为了多样性把低优先级抬到前面', () => {
  const a = item('a', { adPractice: true, productCategory: '食品' });
  const b = item('b', { adPractice: true, productCategory: '食品' });
  const c = item('c', { adPractice: true, productCategory: '宠物' });
  const d = item('d', { productCategory: '家居' });
  assert.deepEqual(feed([a, b, c, d]).groups.map(g => g.article.id), ['a', 'c', 'b', 'd']);
});
test('合并同事件，仍能搜索解读文、在交叉栏目找到内容', () => {
  const a = item('official', { eventGroup: 'event', sections: ['行业动态'] });
  const b = item('解读', { eventGroup: 'event', sections: ['行业动态', 'AI营销'] });
  assert.equal(feed([a, b]).groups.length, 1);
  const result = feed([a, b], { query: '解读', section: 'AI营销' });
  assert.equal(result.groups[0].article.id, '解读');
  assert.equal(result.groups[0].related[0].id, 'official');
  assert.equal(feed([{ ...a, collectionApproved: false }]).matchingArticles, 0);
});
test('实际48篇全部保留，明确偏好生效，043不伪造用户加分', () => {
  const data = JSON.parse(fs.readFileSync('site/preview/content.json', 'utf8'));
  const labels = JSON.parse(fs.readFileSync('docs/精选校准/标记.json', 'utf8'));
  const baseline = data.items.filter((a: Article) => a.id.startsWith('article-'));
  assert.equal(baseline.length, 48);
  assert.equal(new Set(data.items.map((a: Article) => a.id)).size, data.items.length);
  assert.equal(feed(baseline).groups.length, 47);
  for (const n of ['042', '044']) assert.equal(priority(data.items.find((a: Article) => a.id === `article-${n}`)).tier, 2);
  assert.equal(priority(data.items.find((a: Article) => a.id === 'article-047')).tier, 0);
  assert.equal(labels.labels.find((l: { number: string }) => l.number === '043').priorityPreference.direction, 'diversify');
  assert.equal(labels.labels.find((l: { number: string }) => l.number === '001').reason, null);
  assert.equal(feed(data.items, { query: 'Skai' }).matchingArticles, 1);
});
