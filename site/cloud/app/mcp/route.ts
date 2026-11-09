import { refreshBatch, sources } from '@/lib/collector';
import baseline from '@/data/baseline.json';
import { isOwner } from '@/lib/owner';
import { assess, assessmentKey, modelReady, recentAssessments } from '@/lib/deepseek';
import type { Assessment } from '@/lib/hot-ranking';
import { digestKey, loadDigestVersion, saveDigestVersion, readBatches, readJson, recentCandidates, readRunEvents, saveRunEvent, type Digest, type DigestItem, type RunEvent, type RunStage } from '@/lib/daily-store';

export const dynamic = 'force-dynamic';
const version = '2026-07-28';
const validSections = new Set(['行业动态', '教程', '案例', '工具', 'AI营销']);
const allowedTutorialTags = new Set((baseline.items as { tutorialTags?: string[] }[]).flatMap(item => item.tutorialTags || []));

const tools = [
  { name: 'analyze_article', description: '在原文核实后、publish_digest之前调用。使用DeepSeek按AIHOT标准独立评分两次并归组事件，保存回执和AI价值分。body必须是实际取得的原文材料，不能用自写摘要代替；sourceTime仅在核实精确时间及时区时填写，否则省略。每篇最多三次模型请求，失败不发布评分。', inputSchema: {type:'object',properties:{runId:{type:'string'},url:{type:'string'},body:{type:'string',minLength:200,maxLength:60000},sourceTime:{type:'string'}},required:['url','body']} },
  { name: 'refresh_batch', description: '联网检查已配置的6个左右公开信源，保存最新线索和来源状态。批次为0至6。每日任务传同一个runId以记录运行结果。', inputSchema: { type: 'object', properties: { batch: { type: 'integer', minimum: 0, maximum: 6 }, runId: { type: 'string' } }, required: ['batch'] } },
  { name: 'get_recent', description: '读取近期已采集线索及各来源检查状态，日期缺失的线索须核对原文后再选材。', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 80 } } } },
  { name: 'record_verification', description: '记录逐篇原文核实结果与失败原因。每日任务传与信源检查相同的runId。', inputSchema: { type: 'object', properties: { runId: { type: 'string' }, items: { type: 'array', minItems: 1, maxItems: 15, items: { type: 'object', properties: { url: { type: 'string' }, status: { enum: ['verified', 'failed'] }, evidence: { type: 'string' }, error: { type: 'string' } }, required: ['url', 'status'] } } }, required: ['items'] } },
  { name: 'publish_digest', description: '发布当前已采集并逐篇核实的中文精选。每次最多15条；重试按网址去重。每日任务传相同runId。', inputSchema: { type: 'object', properties: { runId: { type: 'string' }, items: { type: 'array', maxItems: 15, items: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, points: { type: 'array', items: { type: 'string' } }, section: { type: 'string' }, reason: { type: 'string' }, materialNote: { type: 'string' }, sourceRole: { enum: ['official','analysis','reprint'] }, eventGroup: { type: 'string', description: '同一事件或通稿共用的稳定标识' }, publishedAt: { type: 'string', description: '原文核实的当地发布日期，最多与信源列表日期相差一天' }, tutorialTags: { type: 'array', items: { type: 'string' }, maxItems: 5 } }, required: ['url', 'title', 'summary', 'points', 'reason', 'materialNote'] } } }, required: ['items'] } },
  { name: 'get_status', description: '读取站点云端采集时间、39个来源状态和已发布的增量条数。', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_run_log', description: '按runId读取信源检查、原文核实、精选发布的运行事件与失败记录。', inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] } },
];

function runId(args: Record<string, unknown>): string {
  const value = args.runId === undefined
    ? `unattributed-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}`
    : String(args.runId);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value)) throw Error('runId只能包含小写字母、数字、短横线和下划线，最多80字');
  return value;
}

async function record(run: string, stage: RunStage, status: RunEvent['status'], evidence: Record<string, unknown>) {
  await saveRunEvent({ at: new Date().toISOString(), runId: run, stage, status, evidence });
}

async function tracked<T>(run: string, stage: RunStage, attempt: Record<string, unknown>, action: () => Promise<{ result: T; status: RunEvent['status']; evidence: Record<string, unknown> }>): Promise<T> {
  await record(run, stage, 'started', attempt);
  let outcome: { result: T; status: RunEvent['status']; evidence: Record<string, unknown> };
  try {
    outcome = await action();
  } catch (error) {
    await record(run, stage, 'failed', { ...attempt, error: String((error as Error).message).slice(0, 500) });
    throw error;
  }
  await record(run, stage, outcome.status, outcome.evidence);
  return outcome.result;
}

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
      (tutorialTags.length && section !== '教程')) throw Error('教程标签无效');
    const item: DigestItem = { id: await idFor(candidate.url), title, sourceName: candidate.sourceName, url: candidate.url,
      publishedAt, updatedAt: null, summary, points,
      reason, materialNote, collectedAt: byUrl.get(candidate.url)?.collectedAt || now,
      tutorialTags,
      sourceRole: ['official','analysis','reprint'].includes(String(x.sourceRole)) ? String(x.sourceRole) : undefined,
      collectionApproved: true, features: { sections: [section], eventGroup: String(x.eventGroup || '').trim() || undefined } };
    const assessment = await readJson<Assessment | null>(await assessmentKey(item.url),null);
    if (modelReady() && !assessment) throw Error('请先调用analyze_article完成DeepSeek评分与归组');
    if (assessment) item.assessment = assessment;
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
  if (name === 'analyze_article') {
    const url = String(args.url || '');
    return tracked(runId(args),'ai_analysis',{url},async()=>{
    const batches = await readBatches();
    const {digest,etag} = await loadDigestVersion();
    const candidate = batches.flatMap(b=>b.items).find(x=>x.url===url);
    const baselineItem = baseline.items.find(x=>x.url===url);
    const published = digest.items.find(x=>x.url===url) || (baselineItem ? structuredClone(baselineItem) as DigestItem : undefined);
    if (!candidate && !published) throw Error('只能评分已采集或已发布的文章');
    const source = sources.find(s=>s.id===candidate?.sourceId || s.name===published?.sourceName);
    if (!source) throw Error('来源身份尚未配置');
    const rawTime = args.sourceTime ? String(args.sourceTime) : null;
    if (rawTime && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(rawTime) || !Number.isFinite(Date.parse(rawTime)) || Date.parse(rawTime)>Date.now())) throw Error('原文精确时间必须带时区且不能晚于现在');
    const listed = candidate?.publishedAt || published?.publishedAt;
    if (rawTime && listed && Math.abs(Date.parse(rawTime)-Date.parse(listed))>86400_000) throw Error('核实时间与信源日期不一致');
    const result = await assess({url,title:candidate?.title || published!.title,body:String(args.body || ''),sourceTime:rawTime,
      participant: /(^|\.)amazon\.com$/.test(source.host) ? 'amazon' : source.host.replace(/^www\./,''),sourceName:source.name},
      await recentAssessments());
    if (published) {
      published.assessment=result;
      if (!digest.items.some(x=>x.url===url)) digest.items.push(published);
      digest.updatedAt=new Date().toISOString(); await saveDigestVersion(digest,etag);
    }
    return {result,status:'succeeded' as const,evidence:{url,score:result.score,kind:result.kind,eventId:result.eventId,receipts:result.receipts}};
    });
  }
  if (name === 'refresh_batch') {
    const run = runId(args), batchNumber = Number(args.batch);
    return tracked(run, 'source_check', { batch: batchNumber }, async () => {
      const batch = await refreshBatch(batchNumber);
      return { result: { checkedAt: batch.checkedAt, sources: batch.sources, items: batch.items },
        status: batch.sources.some(source => source.error) ? 'partial' as const : 'succeeded' as const,
        evidence: { batch: batchNumber, checkedAt: batch.checkedAt, sources: batch.sources, candidates: batch.items.length } };
    });
  }
  if (name === 'get_recent') {
    const batches = await readBatches();
    return { configuredSources: sources.length, checkedAt: batches.map(x => x.checkedAt).sort().at(-1) || null,
      sourceChecks: batches.flatMap(x => x.sources), items: recentCandidates(batches, Math.min(80, Number(args.limit) || 40)) };
  }
  if (name === 'record_verification') {
    const run = runId(args);
    const urls = Array.isArray(args.items) ? args.items.map(item => String((item as Record<string, unknown>)?.url || '')) : [];
    return tracked(run, 'original_verification', { urls }, async () => {
      const items = args.items;
      if (!Array.isArray(items) || !items.length || items.length > 15) throw Error('核实记录必须包含1至15篇');
      const checked = items.map(raw => {
        if (!raw || typeof raw !== 'object') throw Error('核实记录格式错误');
        const item = raw as Record<string, unknown>;
        const url = String(item.url || '');
        const status = String(item.status || '');
        const evidence = String(item.evidence || '').trim();
        const error = String(item.error || '').trim();
        if (!/^https:\/\//.test(url) || !['verified', 'failed'].includes(status)) throw Error('核实网址或状态无效');
        if (status === 'verified' && evidence.length < 12) throw Error('已核实条目需要原文证据');
        if (status === 'failed' && !error) throw Error('核实失败需要原因');
        return { url, status, evidence, error };
      });
      const failed = checked.filter(item => item.status === 'failed').length;
      return { result: { recorded: checked.length, failed },
        status: failed === checked.length ? 'failed' as const : failed ? 'partial' as const : 'succeeded' as const,
        evidence: { items: checked } };
    });
  }
  if (name === 'publish_digest') {
    const run = runId(args);
    const urls = Array.isArray(args.items) ? args.items.map(item => String((item as Record<string, unknown>)?.url || '')) : [];
    return tracked(run, 'publication', { urls }, async () => {
      const result = await publish(args);
      return { result, status: 'succeeded' as const, evidence: { ...result, urls } };
    });
  }
  if (name === 'get_run_log') {
    const run = runId(args);
    const events = await readRunEvents(run);
    const stages: Record<RunStage, string> = { source_check: 'not_recorded', original_verification: 'not_recorded', ai_analysis:'not_recorded', publication: 'not_recorded' };
    for (const event of events.filter(event => event.stage !== 'source_check')) stages[event.stage] = event.status === 'started' ? 'incomplete' : event.status;
    const batches = new Map<number, RunEvent>();
    for (const event of events.filter(event => event.stage === 'source_check')) {
      const batch = Number(event.evidence.batch);
      if (Number.isInteger(batch) && batch >= 0 && batch <= 6) batches.set(batch, event);
    }
    const batchStatuses = [...batches.values()].map(event => event.status);
    if (batchStatuses.includes('failed')) stages.source_check = 'failed';
    else if (batchStatuses.includes('partial')) stages.source_check = 'partial';
    else if (batches.size === 7 && batchStatuses.every(status => status === 'succeeded')) stages.source_check = 'succeeded';
    else if (batches.size) stages.source_check = 'incomplete';
    const verified = new Map<string, string>();
    for (const event of events.filter(event => event.stage === 'original_verification' && event.status !== 'started')) {
      if (!Array.isArray(event.evidence.items)) continue;
      for (const item of event.evidence.items as { url: string; status: string }[]) verified.set(item.url, item.status);
    }
    const verificationFailures = [...verified.values()].filter(status => status === 'failed').length;
    if (verified.size && !['incomplete', 'failed'].includes(stages.original_verification)) stages.original_verification = verificationFailures === verified.size ? 'failed' : verificationFailures ? 'partial' : 'succeeded';
    const sourceFailures = [...batches.values()].flatMap(event => Array.isArray(event.evidence.sources)
      ? (event.evidence.sources as { id: string; name: string; error: string | null }[]).filter(source => source.error) : []);
    return { runId: run, stages, completedBatches: [...batches].filter(([, event]) => event.status === 'succeeded' || event.status === 'partial').map(([batch]) => batch).sort(),
      sourceFailures, verifiedItems: verified.size - verificationFailures, verificationFailures, events };
  }
  if (name === 'get_status') {
    const batches = await readBatches();
    const digest = await readJson<Digest>(digestKey, { updatedAt: null, items: [] });
    return { modelReady: modelReady(), configuredSources: sources.length, checkedAt: batches.map(x => x.checkedAt).sort().at(-1) || null,
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
