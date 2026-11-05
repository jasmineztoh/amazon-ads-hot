import { env } from 'cloudflare:workers';

// These identity headers are set by Sites after authentication.
export function isOwner(request: Request): boolean {
  const owner = (env as Cloudflare.Env & { SITE_OWNER_EMAIL?: string }).SITE_OWNER_EMAIL?.trim().toLowerCase();
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  return Boolean(owner && request.headers.get('oai-authenticated-user-id') && email === owner);
}
