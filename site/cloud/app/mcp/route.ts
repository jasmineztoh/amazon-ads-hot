import { refreshBatch, sources } from '@/lib/collector';
import baseline from '@/data/baseline.json';
import { isOwner } from '@/lib/owner';
import { digestKey, loadDigestVersion, saveDigestVersion, readBatches, readJson, recentCandidates, type Digest, type DigestItem } from '@/lib/daily-store';

export const dynamic = 'force-dynamic';
const version = '2026-07-28';
const validSections = new Set(['行业动态', '教程（新人入门与进阶）', '案例', '工具', 'AI营销']);
const allowedTutorialTags = new Set((baseline.items as { tutorialTags?: string[] }[]).flatMap(item => item.tutorialTags || []));

const tools = [
  { name: 'refresh_batch', description: '联网检查已配置的6个左右公开信源，保存最新线索和来源状态。批次为0至6。', inputSchema: { type: 'object', properties: { batch: { type: 'integer', minimum: 0, maximum: 6 } }, required: ['batch'] } },
  { name: 'get_recent', description: '读取近期已采集线索及各来源检查状态，日期缺失的线索须核对原文后再选材。', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 80 } } } },
  { name: 'publish_digest', description: '发布当前已采集并逐篇核实的中文精选。每次最多15条；重试按网址去重。', inputSchema: { type: 'object', properties: { items: { type: 'array', maxItems: 15, items: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, points: { type: 'array', items: { type: 'string' } }, section: { type: 'string' }, reason: { type: 'string' }, materialNote: { type: 'string' }, sourceRole: { enum: ['official','analysis','reprint'] }, eventGroup: { type: 'string', description: '同一事件或通稿共用的稳定标识' }, publishedAt: { type: 'string', description: '原文核实的当地发布日期，最多与信源列表日期相差一天' }, tutorialTags: { type: 'array', items: { type: 'string' }, maxItems: 5 } }, required: ['url', 'title', 'summary', 'points', 'reason', 'materialNote'] } } }, required: ['items'] } },
  { name: 'get_status', description: '读取站点云端采集时间、39个来源状态和已发布的增量条数。', inputSchema: { type: 'object', properties: {} } },
];

async function idFor(url: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return `daily-${Array.from(new Uint8Array(bytes)).slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

async function publish(args: Record<string, unknown>) {
  const input = args.items;
  if (!Array.isArray(input) || input.length > 15) throw Error('每次最多15条');
  const batches = await readBatches();
  const candidates = new Map(recentCandidates(batches, 200).map(x => [x.url, x]));
  const { digest: before, etag } = await loadDigestVersion();
  const byUrl = new Map(before.items.map(x => [x.url, x]));
  const now = new Date().toISOString();
  let accepted = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw Error('条目格式错误');
    const x = raw as Record<string, unknown>;
    const candidate = candidates.get(String(x.url || ''));
    if (!candidate) throw Error(`网址不在最近采集结果中: ${String(x.url || '').slice(0, 120)}`);
    const title = String(x.title || '').trim(), summary = String(x.summary || '').trim();
    if (!/[\p{Script=Han}]/u.test(title) || title.length < 8 || summary.length < 30 || summary.length > 1000) throw Error('中文标题或摘要不完整');
    const points = Array.isArray(x.points) ? x.points.filter(p => typeof p === 'string' && p.trim()).slice(0, 5) as string[] : [];
    const section = validSections.has(String(x.section)) ? String(x.section) : '行业动态';
    const reason = String(x.reason || '').trim();
    const materialNote = String(x.materialNote || '').trim();
    if (!points.length || reason.length < 8 || materialNote.length < 8) throw Error('缺少要点、具体推荐理由或适用条件');
    const listedAt = candidate.publishedAt?.slice(0, 10);
    const verifiedAt = String(x.publishedAt || '').slice(0, 10);
    const publishedAt = verifiedAt || listedAt || '';
    const t = Date.parse(publishedAt);
    if (!Number.isFinite(t) || t > Date.now() + 86_400_000 || t < Date.now() - 60 * 86_400_000) throw Error('发布日期缺失或超出最近60天');
    if (listedAt && verifiedAt && Math.abs(Date.parse(listedAt) - t) > 86_400_000) throw Error('原文日期与信源列表差异超过一天，先核实来源');
    const tutorialTags = x.tutorialTags === undefined ? [] : x.tutorialTags;
    if (!Array.isArray(tutorialTags) || tutorialTags.length > 5 ||
      tutorialTags.some(tag => typeof tag !== 'string' || !allowedTutorialTags.has(tag)) ||
      (tutorialTags.length && section !== '教程（新人入门与进阶）')) throw Error('教程标签无效');
    const item: DigestItem = { id: await idFor(candidate.url), title, sourceName: candidate.sourceName, url: candidate.url,
      publishedAt, updatedAt: null, summary, points,
      reason, materialNote, collectedAt: byUrl.get(candidate.url)?.collectedAt || now,
      tutorialTags,
      sourceRole: ['official','analysis','reprint'].includes(String(x.sourceRole)) ? String(x.sourceRole) : undefined,
      collectionApproved: true, features: { sections: [section], eventGroup: String(x.eventGroup || '').trim() || undefined } };
    byUrl.set(item.url, item);
    accepted++;
  }
  // The freshness window applies at intake. Saved and shared articles keep their URLs.
  const items = [...byUrl.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const digest = { updatedAt: new Date().toISOString(), items };
  await saveDigestVersion(digest, etag);
  return { accepted, total: items.length, updatedAt: digest.updatedAt };
}

async function call(name: string, args: Record<string, unknown>) {
  if (name === 'refresh_batch') {
    const batch = await refreshBatch(Number(args.batch));
    return { checkedAt: batch.checkedAt, sources: batch.sources, items: batch.items };
  }
  if (name === 'get_recent') {
    const batches = await readBatches();
    return { configuredSources: sources.length, checkedAt: batches.map(x => x.checkedAt).sort().at(-1) || null,
      sourceChecks: batches.flatMap(x => x.sources), items: recentCandidates(batches, Math.min(80, Number(args.limit) || 40)) };
  }
  if (name === 'publish_digest') return publish(args);
  if (name === 'get_status') {
    const batches = await readBatches();
    const digest = await readJson<Digest>(digestKey, { updatedAt: null, items: [] });
    return { configuredSources: sources.length, checkedAt: batches.map(x => x.checkedAt).sort().at(-1) || null,
      checkedSources: batches.flatMap(x => x.sources).length, errors: batches.flatMap(x => x.sources).filter(x => x.error),
      latestCandidates: recentCandidates(batches, 80).length, publishedItems: digest.items.length, publishedAt: digest.updatedAt };
  }
  throw Error('未知工具');
}

export async function POST(request: Request) {
  let id: unknown = null;
  try {
    const message = await request.json() as { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    id = message.id ?? null;
    if (message.method === 'server/discover') return Response.json({ jsonrpc: '2.0', id, result: { supportedVersions: [version], capabilities: { tools: {} } } });
    if (message.method === 'tools/list') return Response.json({ jsonrpc: '2.0', id, result: { tools } });
    if (message.method === 'tools/call') {
      if (!isOwner(request)) return Response.json({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Owner access required' } }, { status: 403 });
      const result = await call(String(message.params?.name || ''), message.params?.arguments || {});
      return Response.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    }
    return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  } catch (error) {
    return Response.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String((error as Error).message) }], isError: true } });
  }
}
