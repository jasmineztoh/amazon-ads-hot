import { feed, priority } from './curation.js';
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const x = document.createElement(tag); if (text) x.textContent = text; if (className) x.className = className; return x; };
const link = (text, url, className) => { const a = el('a', text, className); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
let data, section = '', limit = 12, runtimeLive = false;
function updateNote() {
  const checked = data.updatedAt ? new Date(data.updatedAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : null;
  $('collection-note').textContent = `${data.total} 篇已收录内容${checked ? ` · 最近检查 ${checked}` : ''}`;
  $('update-note').textContent = runtimeLive ? '本机服务运行中，每2小时检查信源；官方中文摘要核对正文后收录，英文内容经整理后展示。' : '当前显示已保存内容；本次预览未开启自动采集。';
}
function render() {
  const result = feed(data.items, { section, query: $('search').value, sort: $('sort').value });
  const visible = result.groups.slice(0, limit);
  $('result-count').textContent = `${result.matchingArticles} 篇内容 · ${result.groups.length} 条${visible.length < result.groups.length ? ` · 当前展示 ${visible.length} 条` : ''}`;
  $('articles').replaceChildren();
  if (!visible.length) $('articles').append(el('p', '没有找到相关内容，试试其它关键词或栏目。', 'empty'));
  for (const { article: a, related } of visible) {
    const item = el('article', '', 'article'); item.dataset.id = a.id;
    const meta = el('div', '', 'meta'); meta.append(el('span', a.sourceName, 'source'));
    const time = el('time', a.publishedAt.replaceAll('-', '.')); time.dateTime = a.publishedAt; meta.append(time);
    if (a.updatedAt) meta.append(el('span', `更新 ${a.updatedAt.replaceAll('-', '.')}`));
    const p = priority(a); if (p.label && $('sort').value !== 'date') meta.append(el('span', p.label, p.tier === 0 ? 'priority low' : 'priority'));
    item.append(meta); const h = el('h3'); h.append(link(a.title, a.url)); item.append(h, el('p', a.summary, 'summary'));
    const bottom = el('div', '', 'article-bottom'), tags = el('div', '', 'tags');
    a.features.sections.forEach(s => tags.append(el('span', s.startsWith('教程') ? '教程' : s)));
    if (a.features.productCategory) tags.append(el('span', a.features.productCategory));
    bottom.append(tags, link('读原文 ↗', a.url, 'original')); item.append(bottom);
    const details = el('details', '', 'details'); details.append(el('summary', a.points.length ? '展开要点' : '阅读说明'));
    const points = el('ul'); a.points.forEach(t => points.append(el('li', t))); details.append(points, el('p', a.materialNote, 'note'));
    item.append(details);
    if (related.length) { const r = el('div', '', 'related'); r.append(el('span', '同一事件的其它来源：'));
      related.forEach((b, i) => { if (i) r.append(document.createTextNode(' · ')); r.append(link(`${b.sourceName} · ${b.title}`, b.url)); }); item.append(r); }
    $('articles').append(item);
  }
  $('more').hidden = visible.length >= result.groups.length;
}
try {
  const response = await fetch('/content.json'); if (!response.ok) throw Error('数据读取失败'); data = await response.json();
  try { runtimeLive = (await (await fetch('/runtime.json')).json()).live === true; } catch {}
  for (const s of ['', ...data.sections]) {
    const b = el('button', s || '全部'); b.type = 'button'; b.setAttribute('aria-pressed', String(!s));
    b.addEventListener('click', () => { section = s; limit = 12; for (const x of $('filters').children) x.setAttribute('aria-pressed', String(x === b)); render(); });
    $('filters').append(b);
  }
  $('search').addEventListener('input', () => { limit = 12; render(); });
  $('sort').addEventListener('change', () => { limit = 12; render(); });
  $('more').addEventListener('click', () => { limit += 12; render(); }); updateNote(); render();
  setInterval(async () => {
    try {
      const response = await fetch('/content.json'); if (!response.ok) return;
      const next = await response.json(), changed = next.revision !== data.revision;
      try { runtimeLive = (await (await fetch('/runtime.json')).json()).live === true; } catch { runtimeLive = false; }
      data = next; updateNote(); if (changed) render();
    } catch { runtimeLive = false; updateNote(); /* 暂时读取失败时保留当前可读内容。 */ }
  }, 60_000);
} catch { $('result-count').textContent = '内容暂时无法读取，请刷新重试。'; }
