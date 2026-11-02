import { refreshBatch } from '@/lib/collector';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: 'origin-not-allowed' }, { status: 403 });
  }
  let batch: number;
  try {
    batch = Number((await request.json() as { batch?: unknown }).batch);
  } catch {
    return Response.json({ error: 'invalid-request' }, { status: 400 });
  }
  if (!Number.isInteger(batch) || batch < 0 || batch > 6) {
    return Response.json({ error: 'invalid-batch' }, { status: 400 });
  }
  try {
    const result = await refreshBatch(batch);
    return Response.json({ checkedAt: result.checkedAt, checkedSources: result.sources.length,
      candidates: result.items.length, errors: result.sources.filter(source => source.error) },
    { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Cloud source check failed', error);
    return Response.json({ error: 'refresh-failed' }, { status: 503 });
  }
}
