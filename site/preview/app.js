import { feed, hotStories } from '/curation.js';

const $ = id => document.getElementById(id);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const internalLink = (text, id) => {
  const a = el('a', text);
  a.href = `/items/${encodeURIComponent(id)}`;
  a.addEventListener('click', () => {
    if (!currentId()) {
      try { sessionStorage.setItem('amazon-marketing-list', JSON.stringify({ section, tutorialTag, query: $('search').value, sort: $('sort').value, savedOnly, limit })); } catch {}
    }
  });
  return a;
};
const externalLink = (text, url, className = 'original') => {
  const a = el('a', text, className);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
};
const roleLabels = { official: '官方公告', analysis: '解读', reprint: '转载' };
const storageKey = 'amazon-marketing-saved';
let saved = new Set();
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(stored)) saved = new Set(stored.filter(x => typeof x === 'string'));
} catch { /* 本地存储不可用时仍可阅读。 */ }

let data, section = '', limit = 12, hosted = false, savedOnly = false;
let tutorialTag = '';
let eventMembers = new Map();
let canUpdate = false, guidePage = 0;
const dateText = value => {
  if (!value) return '未知';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return '未知';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
};
function updateNote() {
  const featured = data.featuredUpdatedAt || null;
  $('collection-note').textContent = `${data.total} 篇已收录 · 精选更新至 ${dateText(featured)}`;
  $('update-note').textContent = '公开内容已整理；具体适用条件请结合原文核对。';
}
function bookmark(article) {
  const button = el('button', saved.has(article.id) ? '已收藏' : '收藏', 'bookmark');
  button.type = 'button';
  button.setAttribute('aria-pressed', String(saved.has(article.id)));
  button.addEventListener('click', () => {
    if (saved.has(article.id)) saved.delete(article.id);
    else saved.add(article.id);
    try { localStorage.setItem(storageKey, JSON.stringify([...saved])); } catch { /* 当前页面内仍可使用。 */ }
    if (currentId()) renderDetail();
    else render();
  });
  return button;
}
function currentId() {
  const match = location.pathname.match(/^\/items\/([^/]+)\/?$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}
function indexEvents() {
  eventMembers = new Map();
  for (const group of feed(data.items, { sort: 'collected' }).groups) {
    const members = [group.article, ...group.related];
    if (members.length > 1) {
      for (const member of members) eventMembers.set(member.id, members);
    }
  }
}
function eventSources(article) {
  return (eventMembers.get(article.id) || []).filter(other => other.id !== article.id);
}
function sourcesBlock(article) {
  const related = eventSources(article);
  if (!related.length) return null;
  const block = el('div', '', 'related');
  block.append(el('strong', '同一事件的来源'));
  const list = el('ul');
  for (const item of [article, ...related]) {
    const row = el('li');
    const role = roleLabels[item.sourceRole] || '相关报道';
    row.append(document.createTextNode(`${role} · `), internalLink(item.sourceName, item.id));
    list.append(row);
  }
  block.append(list);
  return block;
}
function renderGuides() {
  $('guides').replaceChildren();
  const visible = section === '教程' && !$('search').value.trim() && !savedOnly && !tutorialTag;
  $('guide-heading').hidden = !visible;
  if (!visible) return;
  const guides = (data.guides || []).filter(guide => (guide.steps || []).some(step => data.items.some(item => item.id === step.articleId)));
  $('next-guides').hidden = guides.length <= 4;
  const pages = Math.ceil(guides.length / 4);
  const start = (guidePage % Math.max(1, pages)) * 4;
  for (const guide of guides.slice(start, start + 4)) {
    const panel = el('details', '', 'guide');
    panel.append(el('summary', guide.title), el('p', guide.description));
    const list = el('ol');
    for (const step of guide.steps || []) {
      const article = data.items.find(item => item.id === step.articleId);
      if (!article) continue;
      const row = el('li');
      row.append(internalLink(article.title, article.id));
      if (step.note) row.append(el('span', step.note));
      list.append(row);
    }
    if (list.children.length) { panel.append(list); $('guides').append(panel); }
  }
}
function renderTutorialFilters() {
  const nav = $('tutorial-filters');
  nav.hidden = section !== '教程';
  nav.replaceChildren();
  if (nav.hidden) return;
  const tutorials = data.items.filter(item => item.features?.sections?.includes(section));
  const names = data.tutorialTags || [...new Set(tutorials.flatMap(item => item.tutorialTags || []))];
  for (const name of ['全部教程', ...names]) {
    const count = name === '全部教程' ? tutorials.length : tutorials.filter(item => item.tutorialTags?.includes(name)).length;
    if (!count) continue;
    const active = name === '全部教程' ? !tutorialTag : tutorialTag === name;
    const button = el('button', name, 'topic-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(active));
    button.append(el('span', String(count), 'topic-count'));
    button.addEventListener('click', () => { tutorialTag = name === '全部教程' ? '' : name; limit = 12; render(); });
    nav.append(button);
  }
}
function renderHot() {
  const block = $('hot-section');
  block.hidden = !!section || !!$('search').value.trim() || savedOnly;
  if (block.hidden) return;
  const hot = hotStories(data.items);
  $('hot-items').replaceChildren();
  if (!hot.length) {
    $('hot-note').textContent = '近 7 天暂无已核实的新精选';
    $('hot-items').append(el('p', '新内容核实并整理后，会出现在这里。', 'hot-empty'));
    return;
  }
  $('hot-note').textContent = '按近 7 天已核实内容的不同信源数、原文日期排列；暂无热度评分';
  for (const [index, item] of hot.entries()) {
    const card = el('article', '', 'hot-card');
    const art = el('div', '', 'hot-art');
    art.setAttribute('aria-hidden', 'true');
    art.append(el('span', item.article.features?.sections?.[0] || '精选'), el('strong', String(index + 1).padStart(2, '0')));
    const body = el('div', '', 'hot-body');
    const meta = el('div', '', 'hot-meta');
    try {
      const icon = document.createElement('img');
      icon.src = `${new URL(item.article.url).origin}/favicon.ico`;
      icon.alt = '';
      icon.loading = 'lazy';
      icon.addEventListener('error', () => icon.remove(), { once: true });
      meta.append(icon);
    } catch { /* 来源图标不可用时保留文字。 */ }
    meta.append(el('span', item.article.sourceName), el('span', dateText(item.article.publishedAt)));
    const title = el('h4'); title.append(internalLink(item.article.title, item.article.id));
    body.append(meta, title);
    if (item.sourceCount >= 2) body.append(el('span', `${item.sourceCount} 个信源`, 'hot-heat'));
    else body.append(el('span', '近期关注', 'hot-pending'));
    card.append(art, body); $('hot-items').append(card);
  }
}
function render() {
  renderTutorialFilters();
  renderGuides();
  const sort = $('sort').value;
  renderHot();
  const items = data.items.filter(a => (!savedOnly || saved.has(a.id)) && (!tutorialTag || section !== '教程' || a.tutorialTags?.includes(tutorialTag)));
  const result = feed(items, { section, query: $('search').value, sort });
  const visible = result.groups.slice(0, limit);
  $('result-count').textContent = `${result.groups.length} 条${visible.length < result.groups.length ? ` · 当前展示 ${visible.length} 条` : ''}`;
  $('articles').replaceChildren();
  if (!visible.length) $('articles').append(el('p', savedOnly ? '没有找到收藏内容。' : '没有找到相关内容，试试其它关键词或栏目。', 'empty'));
  let lastDay = null;
  for (const { article: a } of visible) {
    const day = dateText(a.collectedAt);
    if (sort === 'collected' && day !== lastDay) {
      const heading = el('h3', day === '未知' ? '收录日期未记录' : `${day} · 收录`, 'date-heading');
      if (day !== '未知') { const time = el('time'); time.dateTime = day; heading.replaceChildren(time); time.textContent = `${day} · 收录`; }
      $('articles').append(heading);
      lastDay = day;
    }
    const item = el('article', '', sort === 'collected' ? 'article timeline-entry' : 'article'); item.dataset.id = a.id;
    const meta = el('div', '', 'meta');
    meta.append(el('span', a.sourceName, 'source'), el('span', `原文 ${dateText(a.publishedAt)}`));
    if (eventSources(a).length && a.sourceRole && roleLabels[a.sourceRole]) meta.append(el('span', roleLabels[a.sourceRole]));
    if (sort !== 'collected') meta.append(el('span', `收录 ${day}`));
    const heading = el('h3'); heading.append(internalLink(a.title, a.id));
    if (a.features?.sections?.some(value => value.startsWith('教程'))) for (const tag of a.tutorialTags || []) {
      const badge = el('button', tag, 'tutorial-badge');
      badge.type = 'button'; badge.title = `查看${tag}教程`;
      badge.addEventListener('click', () => { section = data.sections.find(value => value.startsWith('教程')) || section; tutorialTag = tag; limit = 12; for (const x of $('filters').children) x.setAttribute('aria-pressed', String(x.textContent === section)); render(); $('filters').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      heading.append(badge);
    }
    item.append(meta, heading, el('p', a.summary, 'summary'));
    if (a.reason) item.append(el('p', `推荐理由：${a.reason}`, 'reason'));
    const bottom = el('div', '', 'article-bottom'), tags = el('div', '', 'tags');
    (a.features?.sections || []).forEach(s => tags.append(el('span', s.startsWith('教程') ? '教程' : s)));
    const actions = el('div', '', 'actions');
    actions.append(bookmark(a), externalLink('读原文 ↗', a.url));
    bottom.append(tags, actions); item.append(bottom);
    const sources = sourcesBlock(a);
    if (sources) item.append(sources);
    $('articles').append(item);
  }
  $('more').hidden = visible.length >= result.groups.length;
}
function renderDetail() {
  const id = currentId();
  const detail = $('detail');
  detail.replaceChildren();
  const back = el('a', '← 返回精选', 'back'); back.href = '/?return=1'; detail.append(back);
  const article = data.items.find(item => item.id === id);
  if (!article) { detail.append(el('p', '没有找到这篇内容。', 'empty')); return; }
  const meta = el('div', '', 'meta');
  meta.append(el('span', article.sourceName, 'source'), el('span', `原文 ${dateText(article.publishedAt)}`), el('span', `收录 ${dateText(article.collectedAt)}`));
  if (eventSources(article).length && article.sourceRole && roleLabels[article.sourceRole]) meta.append(el('span', roleLabels[article.sourceRole]));
  detail.append(meta, el('h1', article.title), el('p', article.summary, 'detail-summary'));
  if (article.tutorialTags?.length) {
    const labels = el('div', '', 'detail-tutorial-tags');
    for (const name of article.tutorialTags) labels.append(el('span', name, 'tutorial-badge'));
    detail.insertBefore(labels, detail.querySelector('.detail-summary'));
  }
  if (article.reason) detail.append(el('p', `推荐理由：${article.reason}`, 'reason'));
  if (article.points?.length) {
    detail.append(el('h2', '要点', 'detail-heading'));
    const points = el('ul', '', 'detail-points');
    for (const point of article.points) points.append(el('li', point));
    detail.append(points);
  }
  if (article.materialNote) {
    detail.append(el('h2', '适用条件与材料说明', 'detail-heading'), el('p', article.materialNote, 'detail-text'));
  }
  const actions = el('div', '', 'detail-actions');
  actions.append(bookmark(article), externalLink('查看原文与数据 ↗', article.url));
  detail.append(actions);
  const sources = sourcesBlock(article);
  if (sources) detail.append(sources);
  const relatedIds = new Set(article.relatedIds || []);
  for (const guide of data.guides || []) {
    const steps = guide.steps || [];
    const index = steps.findIndex(step => step.articleId === article.id);
    if (index >= 0 && steps[index + 1]) relatedIds.add(steps[index + 1].articleId);
  }
  const related = [...relatedIds].map(id => data.items.find(item => item.id === id)).filter(Boolean);
  if (related.length) {
    detail.append(el('h2', '接着读', 'detail-heading'));
    const list = el('ul', '', 'detail-points');
    for (const next of related) { const row = el('li'); row.append(internalLink(next.title, next.id)); list.append(row); }
    detail.append(list);
  }
}
async function readRuntime() {
  const response = await fetch('/runtime.json');
  if (!response.ok) return;
  const runtime = await response.json();
  hosted = runtime.mode === 'hosted';
}
async function readContent() {
  let response = await fetch('/api/content', { cache: 'no-store' });
  if (!response.ok && !hosted) response = await fetch('/content.json', { cache: 'no-store' });
  if (!response.ok) throw Error('数据读取失败');
  return response.json();
}
try {
  try { await readRuntime(); } catch { /* 使用本地快照。 */ }
  if (hosted) {
    try {
      const response = await fetch('/api/access', { cache: 'no-store' });
      if (response.ok) canUpdate = (await response.json()).canUpdate === true;
    } catch { /* 阅读不依赖管理权限接口。 */ }
  }
  $('manage-signin').hidden = !hosted || canUpdate;
  data = await readContent();
  indexEvents();
  const isDetail = Boolean(currentId());
  const restoreList = !isDetail && (new URLSearchParams(location.search).has('return') || performance.getEntriesByType('navigation')[0]?.type === 'back_forward');
  if (restoreList) {
    try {
      const state = JSON.parse(sessionStorage.getItem('amazon-marketing-list') || '{}');
      if (data.sections.includes(state.section)) section = state.section;
      if (typeof state.query === 'string') $('search').value = state.query;
      if (typeof state.tutorialTag === 'string') tutorialTag = state.tutorialTag;
      if (['collected', 'recommended', 'date'].includes(state.sort)) $('sort').value = state.sort;
      savedOnly = state.savedOnly === true;
      if (Number.isInteger(state.limit) && state.limit > 0) limit = state.limit;
      $('saved-filter').setAttribute('aria-pressed', String(savedOnly));
      if (location.search) history.replaceState(null, '', '/');
    } catch {}
  }
  document.querySelector('.intro').hidden = isDetail;
  document.querySelector('[aria-labelledby="feed-title"]').hidden = isDetail;
  $('detail').hidden = !isDetail;
  for (const s of ['', ...data.sections]) {
    const button = el('button', s || '全部'); button.type = 'button'; button.setAttribute('aria-pressed', String(s === section));
    button.addEventListener('click', () => { section = s; tutorialTag = ''; limit = 12; for (const x of $('filters').children) x.setAttribute('aria-pressed', String(x === button)); render(); });
    $('filters').append(button);
  }
  $('search').addEventListener('input', () => { limit = 12; render(); });
  $('sort').addEventListener('change', () => { limit = 12; render(); });
  $('more').addEventListener('click', () => { limit += 12; render(); });
  $('saved-filter').addEventListener('click', () => { savedOnly = !savedOnly; limit = 12; $('saved-filter').setAttribute('aria-pressed', String(savedOnly)); render(); });
  $('next-guides').addEventListener('click', () => { guidePage++; renderGuides(); });
  updateNote(); if (isDetail) renderDetail(); else render();
  setInterval(async () => {
    try {
      const next = await readContent(), changed = next.revision !== data.revision;
      data = next; if (changed) indexEvents(); updateNote(); if (changed) { if (isDetail) renderDetail(); else render(); }
    } catch { /* 暂时读取失败时保留当前内容。 */ }
  }, 60_000);
} catch {
  $('result-count').textContent = '内容暂时无法读取，请刷新重试。';
  if (currentId()) { $('detail').hidden = false; $('detail').textContent = '内容暂时无法读取，请刷新重试。'; }
}
