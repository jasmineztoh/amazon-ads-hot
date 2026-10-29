import http from 'node:http';
import fs from 'node:fs/promises';
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/curation.js': ['curation.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/content.json': ['content.json', 'application/json'] };
let updates;
const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  if (route === '/runtime.json' && ['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({live:Boolean(updates),intervalMinutes:120})); return;
  }
  const entry = files[route];
  if (!entry || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await fs.readFile(new URL(`../site/preview/${entry[0]}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'", 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500); res.end('Preview data unavailable'); }
});
server.listen(Number(process.env.PREVIEW_PORT || 4173), '127.0.0.1', () => console.log(`内容试读 http://127.0.0.1:${server.address().port}`));
if (process.argv.includes('--live')) updates = await (await import('../modules/local-mvp/service.ts')).startUpdates();
async function stop() { await updates?.stop(); server.close(() => process.exit(0)); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
