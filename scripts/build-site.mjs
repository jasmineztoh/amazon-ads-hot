import fs from 'node:fs/promises';
import path from 'node:path';
import { buildContent } from '../modules/local-mvp/publish.ts';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'site/cloud');
const checkout = path.resolve(root, '../published-site');
const manifest = JSON.parse(await fs.readFile(path.join(checkout, '.openai/hosting.json'), 'utf8'));
const expected = JSON.parse(await fs.readFile(path.join(source, '.openai/hosting.json'), 'utf8'));
if (manifest.project_id !== expected.project_id || manifest.r2 !== 'BUCKET') throw Error('站点或云存储绑定不匹配');
const preview = path.join(root, 'site/preview');
const content = await buildContent();
const fields = ['id','title','sourceName','url','publishedAt','updatedAt','collectedAt','summary','points','materialNote','collectionApproved','features','evidenceHash','reason','relatedIds','searchTerms','sourceRole','tutorialTags','aiTags'];
const baseline = { total: content.total, sections: content.sections, featuredUpdatedAt: content.featuredUpdatedAt,
  aiMarketing: content.aiMarketing, updatedAt: content.updatedAt, guides: content.guides, tutorialTags: content.tutorialTags, revision: content.revision,
  items: content.items.map(a => Object.fromEntries(fields.filter(k => k in a).map(k => [k, a[k]]))) };
await fs.cp(source, checkout, {recursive:true, filter: file => !file.endsWith('.test.ts')});
await fs.copyFile(path.join(root, 'industry/local-sources.json'), path.join(checkout, 'data/sources.json'));
for (const file of ['app.js','style.css','curation.js']) await fs.copyFile(path.join(preview, file), path.join(checkout, 'public', file));
const html = await fs.readFile(path.join(preview, 'index.html'), 'utf8');
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1];
if (!body || /<script\b/i.test(body)) throw Error('阅读页模板无效');
await fs.writeFile(path.join(checkout, 'data/reader.json'), JSON.stringify(body));
for (const file of ['data/baseline.json', 'public/baseline.json']) await fs.writeFile(path.join(checkout, file), JSON.stringify(baseline) + '\n');
console.log(JSON.stringify({project:manifest.project_id, articles:baseline.total, guides:baseline.guides.length}));
