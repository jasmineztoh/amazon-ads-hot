import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchRss } from '../../packages/backend/src/sources/rss.ts';
import { fromHtml } from '../../packages/backend/src/sources/web-list.ts';
import { readable } from '../../packages/backend/src/content/extract.ts';
import { assertPublicUrl } from '../../packages/backend/src/lib/url.ts';
import { readPublicationDate } from '../../packages/backend/src/sources/dates.ts';
import type { SourceRow } from '../../packages/backend/src/sources/types.ts';
import { DATA_DIR, hash, keyFor, loadStore, saveStore, seedBaseline, upsert, withLock } from './store.ts';
import type { Entry, Source, SourceHealth, Run } from './types.ts';
export const SOURCES_FILE = new URL('../../industry/local-sources.json', import.meta.url);
export const WINDOW_DAYS = 60;
export const CHECK_INTERVAL_MINUTES = 120;
const HOST = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, '');

// 官方站在原HTTP通道中返回过只有1024字节的残缺响应。此处使用本机已实测的原生通道，保留公开地址与固定域名检查。
export async function fetchPublic(url: string, source: Source): Promise<{ text: string; url: string }> {
  const signal = AbortSignal.timeout(20_000);
  for (let hop = 0; hop < 5; hop++) {
    if (HOST(url) !== source.host) throw Error('文章跳到未配置的域名');
    await assertPublicUrl(url, false);
    const response = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': source.language === 'zh' ? 'zh-CN,en;q=0.8' : 'en-US,en;q=0.9' } });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) {
      await response.body?.cancel(); url = new URL(response.headers.get('location')!, url).toString(); continue;
    }
    if (response.status !== 200) { await response.body?.cancel(); throw Error(`HTTP ${response.status}`); }
    const chunks: Uint8Array[] = []; let bytes = 0;
    for await (const chunk of response.body!) { bytes += chunk.byteLength; if (bytes > 8 * 1024 * 1024) throw Error('正文超过8MB'); chunks.push(chunk); }
    return { text: new TextDecoder().decode(Buffer.concat(chunks)), url };
  }
  throw Error('跳转次数过多');
}
export async function listing(source: Source) {
  if (source.kind === 'web_list') {
    if (!source.list?.itemSelector || !source.list.allowUrlPrefixes?.length) throw Error('网页列表缺少条目选择器或文章地址范围');
    const row: SourceRow = { id: source.id, name: source.name, kind: 'web_list', config: { url: source.url, parseMode: 'html', ...source.list, acceptLanguage: 'en-US,en;q=0.9' },
      tier: 'T2', participation_mode: 'editorial', first_party: false, interval_minutes: 120, enabled: true, cursor: null, fail_count: 0 };
    const page = await fetchPublic(source.url, source);
    const result = fromHtml(page.text, page.url, row);
    if (!result.length) throw Error('网页列表没有匹配文章');
    return result.map(c => ({ url: c.url!, title: c.title, excerpt: c.excerpt || '',
      publishedAt: c.publicationTime || c.publishedAt?.toISOString() || null, feedBody: null as string | null }));
  }
  if (source.kind === 'rss') {
    const row: SourceRow = { id: source.id, name: source.name, kind: 'rss', config: { feedUrl: source.url, acceptLanguage: 'en-US,en;q=0.9' },
      tier: 'T2', participation_mode: 'editorial', first_party: false, interval_minutes: 120, enabled: true, cursor: null, fail_count: 0 };
    const result = await fetchRss(row);
    return result.candidates.filter(c => !source.audioDescriptionOnly ||
      (!!c.url && c.url.toLowerCase().endsWith('.mp3') && (c.excerpt || '').trim().length >= 200))
      .map(c => ({ url: c.url!, title: c.title, excerpt: c.excerpt || '',
        publishedAt: c.publicationTime || c.publishedAt?.toISOString() || null,
        feedBody: source.audioDescriptionOnly ? c.excerpt || null : c.bodyStatus === 'ok' ? c.bodyText : null }));
  }
  const r = await fetchPublic(source.url, source), data = JSON.parse(r.text);
  if (!Array.isArray(data) || !data.length) throw Error('官方接口未返回文章列表');
  return data.map((a: Record<string, unknown>) => {
    if (typeof a.url !== 'string' || typeof a.title !== 'string') throw Error('官方接口字段变更');
    const url = a.url.startsWith('/advertising.amazon.com/') ? `https:/${a.url}` : new URL(a.url, 'https://advertising.amazon.com').toString();
    return { url, title: a.title, excerpt: typeof a.description === 'string' ? a.description : '',
      publishedAt: readPublicationDate(String(a.publishDateTimestamp || '')).publicationTime, feedBody: null as string | null };
  });
}
export function dateState(date: string | null, now: string): 'pending' | 'future' | 'old' {
  if (!date) return 'pending';
  const t = Date.parse(date), at = Date.parse(now);
  if (!Number.isFinite(t)) return 'pending';
  if (t > at + 5 * 60_000) return 'future';
  return t < at - WINDOW_DAYS * 86_400_000 ? 'old' : 'pending';
}
// 订阅只保留最近若干篇；已发现的正文任务不能随条目滑出订阅而消失。
export function bodyQueue(store: import('./types.ts').Store, sourceId: string, now: string): Entry[] {
  return Object.values(store.entries).filter(entry => {
    if (entry.sourceId !== sourceId || ['baseline', 'published', 'excluded'].includes(entry.status)) return false;
    const state = dateState(entry.publishedAt, now);
    if (state !== 'pending') { entry.status = state; return false; }
    if (entry.status === 'future' || entry.status === 'old') entry.status = 'pending';
    return !entry.bodyHash;
  }).sort((a, b) => (a.checkedAt || '').localeCompare(b.checkedAt || '') || (b.publishedAt || '').localeCompare(a.publishedAt || ''));
}
export function officialSummary(entry: Entry, now: string) {
  if (!entry.bodyHash || entry.error || !entry.publishedAt || dateState(entry.publishedAt, now) !== 'pending') return;
  if (entry.sourceId !== 'source-001' || (entry.originalTitle.match(/\p{Script=Han}/gu) || []).length < 5 || (entry.excerpt.match(/\p{Script=Han}/gu) || []).length < 12) return;
  entry.publication = { id: entry.id, title: entry.originalTitle, sourceName: entry.sourceName, url: entry.url,
    summary: entry.excerpt, publishedAt: entry.publishedAt.slice(0, 10), updatedAt: null, points: [],
    materialNote: '摘要来自Amazon Ads官方列表，已取得正文；开放地区、账户资格和使用条件请以原文为准，未独立验证效果。',
    features: { sections: ['行业动态'] }, collectionApproved: true, origin: 'publisher-summary', evidenceHash: entry.bodyHash, reviewedAt: now };
  entry.status = 'published';
  return true;
}
export async function collectOnce(dir = DATA_DIR): Promise<Run> {
  return withLock(async () => {
    const store = await loadStore(dir), startedAt = new Date().toISOString();
    const pool = JSON.parse(await fs.readFile(new URL('../../docs/收录池.json', import.meta.url), 'utf8'));
    seedBaseline(store, pool.items, startedAt);
    // 新检出仓库也保留已发布快照；这些是Agent/发行方资料，不冒充原48篇用户标签。
    if (!store.runs.length) try {
      const snapshot = JSON.parse(await fs.readFile(new URL('../../site/collected-content.json', import.meta.url), 'utf8'));
      for (const a of snapshot.items) {
        const key = keyFor(a.url); if (store.entries[key]) continue;
        store.entries[key] = { id: a.id, key, url: a.url, sourceId: a.sourceId, sourceName: a.sourceName,
          originalTitle: a.title, excerpt: a.summary, publishedAt: a.publishedAt, firstSeenAt: a.addedAt,
          lastSeenAt: startedAt, status: 'published', bodyHash: a.evidenceHash, bodyChars: 0, bodyFile: null,
          checkedAt: null, pageDate: a.publishedAt, error: null, publication: a };
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const sources: Source[] = JSON.parse(await fs.readFile(SOURCES_FILE, 'utf8'));
    const run: Run = { startedAt, finishedAt: startedAt, discovered: 0, newEntries: 0, duplicateEntries: 0, bodies: 0, published: 0, failures: 0, sources: [] };
    await fs.mkdir(path.join(dir, 'bodies'), { recursive: true });
    // 每个来源内顺序读取，每批最多六个来源，避免扩源后同时发出过多请求。
    for (let i = 0; i < sources.length; i += 6) await Promise.all(sources.slice(i, i + 6).map(async source => {
      const health: SourceHealth = { id: source.id, name: source.name, attemptedAt: startedAt, successAt: store.sources[source.id]?.successAt || null, candidates: 0, error: null };
      try {
        const candidates = await listing(source);
        if (!candidates.length) throw Error('列表为空，需检查入口而不是当作采集成功');
        health.candidates = candidates.length; health.successAt = new Date().toISOString();
        const feedBodies = new Map<string, string>();
        for (const c of candidates) {
          if (HOST(c.url) !== (source.articleHost || source.host)) continue;
          run.discovered++;
          const { entry, inserted } = upsert(store, { url: c.url, sourceId: source.id, sourceName: source.name, originalTitle: c.title, excerpt: c.excerpt, publishedAt: c.publishedAt }, startedAt);
          if (inserted) run.newEntries++; else run.duplicateEntries++;
          if (['baseline', 'published', 'excluded'].includes(entry.status)) continue;
          const state = dateState(entry.publishedAt, startedAt);
          entry.status = state === 'pending' && entry.error ? 'material_error' : state;
          if (c.feedBody) feedBodies.set(entry.id, c.feedBody);
        }
        const dates = candidates.map(c => c.publishedAt).filter((d): d is string => !!d && Number.isFinite(Date.parse(d))).sort();
        health.latestPublishedAt = dates.filter(d => dateState(d, startedAt) !== 'future').at(-1) || null;
        health.earliestListedAt = dates[0] || null;
        health.recentCandidates = candidates.filter(c => !!c.publishedAt && dateState(c.publishedAt, startedAt) === 'pending').length;
        for (const entry of bodyQueue(store, source.id, startedAt).slice(0, source.bodyLimit)) {
          const feedBody = feedBodies.get(entry.id);
          entry.checkedAt = new Date().toISOString();
          try {
            let text: string;
            if (feedBody) { text = feedBody; entry.bodyVia = 'rss'; }
            else {
              const response = await fetchPublic(entry.url, source);
              const body = readable(response.text, response.url);
              if (!body) throw Error('未取得足够正文，不使用列表摘要冒充正文');
              entry.pageDate = body.publicationTime?.slice(0, 10) || null;
              text = body.text; entry.bodyVia = 'page';
            }
            entry.bodyHash = hash(text); entry.bodyChars = text.length; entry.bodyFile = `bodies/${entry.bodyHash}.txt`;
            await fs.writeFile(path.join(dir, entry.bodyFile), text);
            if (entry.pageDate && entry.publishedAt && entry.pageDate !== entry.publishedAt.slice(0, 10)) throw Error(`列表与原文日期不一致：${entry.publishedAt.slice(0, 10)} / ${entry.pageDate}`);
            entry.checkedAt = new Date().toISOString(); entry.error = null; entry.status = 'pending';
            if (!entry.publishedAt && entry.pageDate) entry.publishedAt = `${entry.pageDate}T00:00:00.000Z`;
            run.bodies++;
            if (officialSummary(entry, startedAt)) run.published++;
          } catch (e) { entry.status = 'material_error'; entry.error = String((e as Error).message).slice(0, 250); run.failures++; }
        }
      } catch (e) { health.error = String((e as Error).message).slice(0, 250); run.failures++; }
      store.sources[source.id] = health; run.sources.push(health);
    }));
    run.sources.sort((a, b) => a.id.localeCompare(b.id)); run.finishedAt = new Date().toISOString();
    store.runs = [...store.runs.slice(-29), run]; await saveStore(store, dir);
    return run;
  }, dir);
}
