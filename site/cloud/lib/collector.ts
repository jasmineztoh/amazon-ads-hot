import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import configured from '../data/sources.json';
import { batchKey, readJson, type Batch, type Candidate, writeJson } from './daily-store';

type Source = {
  id: string; name: string; kind: 'rss' | 'web_list' | 'amazon_updates'; url: string;
  host: string; articleHost?: string; audioDescriptionOnly?: boolean;
  list?: { itemSelector: string; linkSelector?: string; titleSelector?: string; publishedAtSelector?: string;
    publishedAtRegex?: string; allowUrlPrefixes: string[] };
};
export const sources = configured as Source[];
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true, htmlEntities: true });
const atMost = <T>(v: T | T[] | null | undefined): T[] => v == null ? [] : Array.isArray(v) ? v : [v];
const text = (v: unknown): string => {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return text(o['#text'] ?? o['#cdata'] ?? '');
  }
  return '';
};
const clean = (v: unknown) => cheerio.load(`<div>${text(v)}</div>`)('div').first().text().replace(/\s+/g, ' ').trim();
const host = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, '');
const date = (v: unknown): string | null => {
  if (typeof v === 'number' && v > 1_000_000_000) return new Date(v < 1_000_000_000_000 ? v * 1000 : v).toISOString();
  const raw = text(v).trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const allowed = (url: string, source: Source) => {
  try {
    const target = new URL(url);
    return target.protocol === 'https:' && host(url) === (source.articleHost || source.host) &&
      (!source.list?.allowUrlPrefixes?.length || source.list.allowUrlPrefixes.some(p => url.startsWith(p)));
  } catch { return false; }
};
const broad = new Set(['source-138', 'source-140', 'source-143', 'source-161']);
const relevant = (item: Candidate) => !broad.has(item.sourceId) || /amazon|marketplace|retail media|commerce media|sponsored product|ecommerce|e-commerce|shopping ads/i.test(`${item.title} ${item.excerpt}`);

async function publicText(url: string, source: Source): Promise<string> {
  for (let hop = 0; hop < 4; hop++) {
    if (host(url) !== source.host || new URL(url).protocol !== 'https:') throw Error('列表跳到未配置域名');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(18_000),
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, application/atom+xml, application/json, text/html;q=0.8' } });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) {
      url = new URL(response.headers.get('location')!, url).toString();
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length') || 0) > 6_000_000) throw Error('列表超过6MB');
    const body = await response.text();
    if (body.length > 6_000_000) throw Error('列表超过6MB');
    return body;
  }
  throw Error('列表跳转次数过多');
}

function fromRss(raw: string, source: Source, now: string): Candidate[] {
  const doc = xml.parse(raw) as Record<string, any>;
  const rss = atMost(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item);
  const atom = atMost(doc.feed?.entry);
  const out: Candidate[] = [];
  for (const item of [...rss, ...atom] as Record<string, any>[]) {
    let href = text(item.link);
    if (!href) {
      const links = atMost(item.link as Record<string, string> | Record<string, string>[]);
      const link = links.find(x => x?.['@_rel'] === 'alternate') ?? links[0];
      href = link?.['@_href'] || '';
    }
    if (!href && source.audioDescriptionOnly) {
      const enclosure = atMost<Record<string, string>>(item.enclosure)[0];
      href = text(enclosure?.['@_url']);
    }
    if (!href) href = text(item.guid);
    let url: string;
    try {
      const parsed = new URL(href, source.url);
      if (parsed.protocol === 'http:' && host(parsed.toString()) === source.host) parsed.protocol = 'https:';
      url = parsed.toString();
    } catch { continue; }
    if (!allowed(url, source)) continue;
    const title = clean(item.title).slice(0, 220);
    if (title.length < 8) continue;
    const excerpt = clean(item.description ?? item.summary ?? item['content:encoded']).slice(0, 500);
    if (source.audioDescriptionOnly && excerpt.length < 200) continue;
    out.push({ sourceId: source.id, sourceName: source.name, url, title,
      publishedAt: date(item.pubDate ?? item['dc:date'] ?? item.published ?? item.updated), excerpt, capturedAt: now });
  }
  return out;
}

function fromWeb(raw: string, source: Source, now: string): Candidate[] {
  if (!source.list) throw Error('缺少网页列表规则');
  const $ = cheerio.load(raw);
  const out: Candidate[] = [];
  $(source.list.itemSelector).each((_i, element) => {
    const card = $(element);
    const link = source.list!.linkSelector ? card.find(source.list!.linkSelector).first() : card.is('a') ? card : card.find('a').first();
    const href = link.attr('href');
    if (!href) return;
    let url: string;
    try { url = new URL(href, source.url).toString(); } catch { return; }
    if (!allowed(url, source)) return;
    const title = (source.list!.titleSelector ? card.find(source.list!.titleSelector).first().text() : link.text()).replace(/\s+/g, ' ').trim().slice(0, 220);
    if (title.length < 10 || /^(read more|learn more|continue reading)$/i.test(title)) return;
    const dateNode = source.list!.publishedAtSelector ? card.find(source.list!.publishedAtSelector).first() : null;
    let rawDate = dateNode?.attr('datetime') || dateNode?.attr('content') || dateNode?.text() || '';
    if (source.list!.publishedAtRegex) rawDate = rawDate.match(new RegExp(source.list!.publishedAtRegex))?.[1] || '';
    const excerpt = card.text().replace(/\s+/g, ' ').trim().slice(title.length, title.length + 500).trim();
    out.push({ sourceId: source.id, sourceName: source.name, url, title,
      publishedAt: date(rawDate), excerpt, capturedAt: now });
  });
  return out;
}

function fromAmazon(raw: string, source: Source, now: string): Candidate[] {
  const items = JSON.parse(raw);
  if (!Array.isArray(items)) throw Error('官方列表格式变更');
  return items.flatMap((item: Record<string, unknown>) => {
    if (typeof item.url !== 'string' || typeof item.title !== 'string') return [];
    const url = item.url.startsWith('/advertising.amazon.com/') ? `https:/${item.url}` : new URL(item.url, 'https://advertising.amazon.com').toString();
    if (!allowed(url, source)) return [];
    const publishedAt = date(item.publishDateTimestamp ?? item.publishDate);
    if (!publishedAt) return [];
    return [{ sourceId: source.id, sourceName: source.name, url, title: item.title.slice(0, 220),
      publishedAt, excerpt: typeof item.description === 'string' ? clean(item.description).slice(0, 500) : '', capturedAt: now }];
  });
}

function selectRecent(items: Candidate[], source: Source): Candidate[] {
  const cutoff = Date.now() - 7 * 86_400_000;
  const seen = new Set<string>();
  return items.filter(item => {
    if (!relevant(item) || Date.parse(item.publishedAt || item.capturedAt) < cutoff) return false;
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).sort((a, b) => (b.publishedAt || b.capturedAt).localeCompare(a.publishedAt || a.capturedAt)).slice(0, source.id === 'source-161' ? 5 : 8);
}

export async function refreshBatch(batchNumber: number): Promise<Batch> {
  if (!Number.isInteger(batchNumber) || batchNumber < 0 || batchNumber > 6) throw Error('批次必须是0至6');
  const now = new Date().toISOString();
  const previous = await readJson<Batch | null>(batchKey(batchNumber), null);
  const firstSeen = new Map(previous?.items.map(item => [item.url, item.capturedAt]) || []);
  const selected = sources.slice(batchNumber * 6, batchNumber * 6 + 6);
  const results = await Promise.all(selected.map(async source => {
    try {
      const raw = await publicText(source.url, source);
      const all = source.kind === 'rss' ? fromRss(raw, source, now) : source.kind === 'web_list' ? fromWeb(raw, source, now) : fromAmazon(raw, source, now);
      for (const item of all) item.capturedAt = firstSeen.get(item.url) || now;
      if (!all.length) throw Error('列表没有匹配文章');
      return { check: { id: source.id, name: source.name, count: all.length, error: null }, items: selectRecent(all, source) };
    } catch (error) { return { check: { id: source.id, name: source.name, count: 0, error: String((error as Error).message).slice(0, 180) }, items: [] as Candidate[] }; }
  }));
  const batch = { checkedAt: now, sources: results.map(x => x.check), items: results.flatMap(x => x.items) };
  await writeJson(batchKey(batchNumber), batch);
  return batch;
}
