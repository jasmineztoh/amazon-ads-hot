import { isOwner } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return Response.json({ canUpdate: isOwner(request) }, {
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  });
}
