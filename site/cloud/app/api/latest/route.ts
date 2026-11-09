import { readBatches, recentCandidates } from '@/lib/daily-store';
import { isOwner } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isOwner(request)) return Response.json({ error: 'owner-required' }, { status: 403 });
  try {
    const batches = await readBatches();
    return Response.json({
      checkedAt: batches.map(batch => batch.checkedAt).sort().at(-1) || null,
      items: recentCandidates(batches, 40),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Could not read latest candidates', error);
    return Response.json({ checkedAt: null, items: [], error: 'cloud-storage-unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
