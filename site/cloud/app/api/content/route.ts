import baseline from '@/data/baseline.json';
import { digestKey, readJson, type Digest, type DigestItem } from '@/lib/daily-store';

export const dynamic = 'force-dynamic';

type Content = typeof baseline;

export async function GET() {
  let digest: Digest = { updatedAt: null, items: [] };
  try {
    digest = await readJson<Digest>(digestKey, digest);
  } catch (error) {
    console.error('Could not read cloud digest', error);
  }

  const byUrl = new Map<string, Content['items'][number] | DigestItem>();
  for (const item of baseline.items) byUrl.set(item.url, item);
  for (const item of digest.items) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  const items = [...byUrl.values()];
  return Response.json({
    total: items.length,
    sections: baseline.sections,
    guides: baseline.guides,
    tutorialTags: baseline.tutorialTags,
    featuredUpdatedAt: items.map(item => item.collectedAt || '').sort().at(-1) || null,
    updatedAt: digest.updatedAt || baseline.updatedAt,
    revision: `${baseline.revision}:${digest.updatedAt || 'baseline'}`,
    items,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
