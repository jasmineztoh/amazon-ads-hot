import { env } from 'cloudflare:workers';

export type Candidate = {
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  publishedAt: string | null;
  excerpt: string;
  capturedAt: string;
};

export type SourceCheck = { id: string; name: string; count: number; error: string | null };
export type Batch = { checkedAt: string; sources: SourceCheck[]; items: Candidate[] };

export type DigestItem = {
  id: string;
  title: string;
  sourceName: string;
  url: string;
  publishedAt: string;
  collectedAt?: string;
  reason?: string;
  sourceRole?: string;
  tutorialTags?: string[];
  updatedAt: null;
  summary: string;
  points: string[];
  materialNote: string;
  collectionApproved: true;
  features: { sections: string[]; eventGroup?: string };
};
export type Digest = { updatedAt: string | null; items: DigestItem[] };

export type RunStage = 'source_check' | 'original_verification' | 'publication';
export type RunEvent = {
  at: string;
  runId: string;
  stage: RunStage;
  status: 'started' | 'succeeded' | 'partial' | 'failed';
  evidence: Record<string, unknown>;
};

function bucket(): R2Bucket {
  if (!env.BUCKET) throw new Error('Site R2 binding BUCKET is unavailable');
  return env.BUCKET;
}

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const value = await bucket().get(key);
  return value ? JSON.parse(await value.text()) as T : fallback;
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await bucket().put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
}

export const batchKey = (n: number) => `daily/batch-${n}.json`;
export const digestKey = 'daily/digest.json';
export async function saveRunEvent(event: RunEvent): Promise<void> {
  const key = `daily/runs/${event.runId}/${event.at.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`;
  await writeJson(key, event);
}

export async function readRunEvents(runId: string): Promise<RunEvent[]> {
  const result = await bucket().list({ prefix: `daily/runs/${runId}/`, limit: 1000 });
  const events = await Promise.all(result.objects.map(object => readJson<RunEvent | null>(object.key, null)));
  return events.filter((event): event is RunEvent => event !== null).sort((a, b) => a.at.localeCompare(b.at));
}
export async function loadDigestVersion() {
  const object = await bucket().get(digestKey);
  const digest: Digest = object ? JSON.parse(await object.text()) : { updatedAt: null, items: [] };
  return { digest, etag: object?.etag };
}
export async function saveDigestVersion(digest: Digest, etag?: string) {
  const saved = await bucket().put(digestKey, JSON.stringify(digest), {
    onlyIf: etag ? { etagMatches: etag } : new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/json' }
  });
  if (!saved) throw Error('另一批精选刚刚更新，请重试本批次。');
}
export async function readBatches(): Promise<Batch[]> {
  const batches = await Promise.all(Array.from({ length: 7 }, (_, n) => readJson<Batch | null>(batchKey(n), null)));
  return batches.filter((x): x is Batch => !!x);
}

export function recentCandidates(batches: Batch[], limit = 40): Candidate[] {
  const seen = new Set<string>();
  const cutoff = Date.now() - 7 * 86_400_000;
  return batches.flatMap(b => b.items).filter(item => {
    if (Date.parse(item.publishedAt || item.capturedAt) < cutoff) return false;
    const key = item.url.replace(/\?.*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (b.publishedAt || b.capturedAt).localeCompare(a.publishedAt || a.capturedAt)).slice(0, limit);
}
