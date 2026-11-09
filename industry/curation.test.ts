import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { feed, hotStories, priority } from './curation.ts';
import type { Article, Features } from './curation.ts';
const item = (id: string, features: Partial<Features> = {}, date = '2026-10-29'): Article => ({
  id, title: id, summary: '', points: [], url: 'https://example.com/', sourceName: 'source',
  publishedAt: date, updatedAt: null, materialNote: '', collectionApproved: true,
  features: { sections: ['教程'], ...features },
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
test('热点只取近期已核实内容，同事件按不同信源计数', () => {
  const one = { ...item('one', { eventGroup: 'launch' }, '2026-11-08'), sourceName: '官方' };
  const two = { ...item('two', { eventGroup: 'launch' }, '2026-11-08'), sourceName: '媒体' };
  const repeat = { ...item('repeat', { eventGroup: 'launch' }, '2026-11-08'), sourceName: '媒体' };
  const recent = item('recent', {}, '2026-11-09');
  const old = item('old', {}, '2026-10-20');
  const draft = { ...item('draft', {}, '2026-11-09'), collectionApproved: false };
  const ranked = hotStories([recent, old, draft, one, two, repeat], Date.parse('2026-11-09T12:00:00Z'));
  assert.deepEqual(ranked.map(x => [x.article.id, x.sourceCount]), [['one', 2], ['recent', 1]]);
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
  assert.ok(feed(data.items, { query: 'Skai' }).matchingArticles >= 1);
});

test('五份同稿只算一个事件，官方公告与独立解读仍可分别阅读', () => {
  const bodyHash = 'a'.repeat(64);
  const official = { ...item('official', { eventGroup: 'launch' }), evidenceHash: bodyHash, sourceRole: 'official' };
  const copies = Array.from({ length: 4 }, (_, n) => ({
    ...item(`copy-${n}`), url: `https://publisher-${n}.example/release`, evidenceHash: bodyHash, sourceRole: 'reprint',
  }));
  const analysis = { ...item('独立解读', { eventGroup: 'launch' }), evidenceHash: 'b'.repeat(64), sourceRole: 'analysis' };
  const different = { ...item('another-event'), evidenceHash: 'c'.repeat(64) };
  const articles = [official, ...copies, analysis, different];
  const result = feed(articles);
  assert.equal(result.groups.length, 2);
  const event = result.groups.find(g => [g.article, ...g.related].some(a => a.id === official.id))!;
  assert.equal(event.related.length, 5);
  assert.deepEqual(new Set([event.article, ...event.related].map(a => a.sourceRole)), new Set(['official', 'reprint', 'analysis']));
  const search = feed(articles, { query: '独立解读' });
  assert.equal(search.groups.length, 1);
  assert.equal(search.groups[0].article.id, analysis.id);
  assert.ok(search.groups[0].related.some(a => a.id === official.id));
  assert.equal(feed([official, ...copies]).groups.length, 1);
});

test('收录时间线把今天补收的旧教程放在前面，保留原文日期', () => {
  const old = { ...item('old-tutorial', {}, '2025-01-02'), collectedAt: '2026-11-02T08:00:00.000Z' };
  const recent = { ...item('recent-news', {}, '2026-11-01'), collectedAt: '2026-11-01T08:00:00.000Z' };
  assert.deepEqual(feed([recent, old], { sort: 'collected' }).groups.map(g => g.article.id), ['old-tutorial', 'recent-news']);
  assert.deepEqual(feed([recent, old], { sort: 'date' }).groups.map(g => g.article.id), ['recent-news', 'old-tutorial']);
  assert.equal(old.publishedAt, '2025-01-02');
});

test('发布内容有推荐理由、原文与收录日期，更新标识分别来自精选和信源检查', () => {
  const data = JSON.parse(fs.readFileSync('site/preview/content.json', 'utf8'));
  for (const a of data.items as Article[]) {
    assert.ok(a.reason?.trim(), `${a.id} 缺少推荐理由`);
    assert.ok(a.summary.trim(), `${a.id} 缺少中文摘要`);
    assert.ok(a.materialNote.trim(), `${a.id} 缺少材料与适用条件`);
    assert.ok(Array.isArray(a.points), `${a.id} 要点格式不正确`);
    assert.ok(Number.isFinite(Date.parse(a.publishedAt)), `${a.id} 原文日期无效`);
    assert.ok(a.collectedAt && Number.isFinite(Date.parse(a.collectedAt)), `${a.id} 收录日期无效`);
    assert.match(a.url, /^https?:\/\//);
  }
  assert.equal(data.featuredUpdatedAt, data.items.map((a: Article) => a.collectedAt).sort().at(-1));
  assert.equal(data.sourceCheckedAt, data.collection?.lastRun?.finishedAt || null);
  const oldTutorial = data.items.find((a: Article) => a.id === 'live-5d40e6689d6498ae');
  assert.equal(oldTutorial.publishedAt, '2026-09-25');
  assert.equal(oldTutorial.collectedAt.slice(0, 10), '2026-11-02');
});

test('新人路线与关联文章都有目标，预算问题能从方法走到案例', () => {
  const data = JSON.parse(fs.readFileSync('site/preview/content.json', 'utf8'));
  const articles: Article[] = data.items;
  const byId = new Map(articles.map(a => [a.id, a]));
  for (const a of articles) for (const id of a.relatedIds || []) assert.ok(byId.has(id), `${a.id} 关联目标不存在 ${id}`);
  const guide = data.guides.find((g: { title: string }) => g.title === '第一次做商品推广');
  assert.ok(guide && guide.steps.length >= 2);
  assert.equal(new Set(guide.steps.map((s: { articleId: string }) => s.articleId)).size, guide.steps.length);
  for (const step of guide.steps) {
    assert.ok(byId.has(step.articleId), `路线目标不存在 ${step.articleId}`);
    assert.ok(step.note.trim(), `路线缺少阅读提示 ${step.articleId}`);
  }
  const matches = feed(articles, { query: '预算花不出去' }).groups.flatMap(g => [g.article, ...g.related]);
  const methods = matches.filter(a => a.features.sections.includes('教程'));
  assert.ok(methods.length > 0, '搜索应找到方法');
  const reached = new Set<string>();
  const pending = [...methods];
  while (pending.length) {
    const a = pending.shift()!;
    if (reached.has(a.id)) continue;
    reached.add(a.id);
    for (const id of a.relatedIds || []) pending.push(byId.get(id)!);
  }
  assert.ok([...reached].some(id => byId.get(id)!.features.sections.includes('案例')), '方法关联链应通向案例');
  const cases = [byId.get('article-020')!, byId.get('live-207c00a4362bf1dc')!];
  assert.ok(cases[0].relatedIds?.includes(cases[1].id));
  assert.ok(cases[1].relatedIds?.includes(cases[0].id));
  assert.equal(feed(cases).groups.length, 2, '不同样本的大促复盘互链，但不合并为同稿');
});
