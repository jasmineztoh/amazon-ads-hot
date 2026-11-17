import aiMarketing from '@/data/ai-marketing.json';
import { applyAiMarketing } from '@/lib/ai-marketing';
import baseline from '@/data/baseline.json';
import { HOT_WINDOW_DAYS, rankHot, type HotArticle } from '@/lib/hot-ranking';
import { digestKey, readJson, type Digest, type DigestItem } from '@/lib/daily-store';

export const dynamic = 'force-dynamic';

type Content = typeof baseline;

export async function GET() {
  let digest: Digest = { updatedAt: null, items: [] };
  try {
    digest = await readJson<Digest>(digestKey, digest);
  } catch (error) {
    console.error('Could not read cloud digest', error);
    return Response.json({ error: '云端内容暂时无法读取，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const byUrl = new Map<string, Content['items'][number] | DigestItem>();
  for (const item of baseline.items) byUrl.set(item.url, item);
  for (const item of digest.items) byUrl.set(item.url, item);
  const items = applyAiMarketing([...byUrl.values()].map(item => ({...item, features: {...item.features,
    sections: item.features.sections.map(s => s.startsWith('教程') ? '教程' : s)}})), aiMarketing);
  return Response.json({
    aiMarketing,
    total: items.length,
    hot: { computedAt: new Date().toISOString(), windowDays: HOT_WINDOW_DAYS, entries: rankHot(items as HotArticle[]) },
    sections: baseline.sections,
    guides: baseline.guides,
    tutorialTags: baseline.tutorialTags,
    featuredUpdatedAt: items.map(item => item.collectedAt || '').sort().at(-1) || null,
    updatedAt: digest.updatedAt || baseline.updatedAt,
    revision: `${baseline.revision}:${digest.updatedAt || 'baseline'}`,
    items,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
