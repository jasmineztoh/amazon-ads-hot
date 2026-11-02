import { readBatches, recentCandidates } from '@/lib/daily-store';

export const dynamic = 'force-dynamic';

export async function GET() {
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
