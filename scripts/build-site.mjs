import fs from 'node:fs/promises';
import path from 'node:path';
const repo = path.resolve(import.meta.dirname, '..');
const checkout = path.resolve(repo, '../published-site');
const output = path.join(checkout, 'dist');
const hosting = JSON.parse(await fs.readFile(path.join(repo, 'site/hosting.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(checkout, '.openai/hosting.json'), 'utf8'));
if (manifest.project_id !== hosting.projectId || manifest.static?.directory !== 'dist') throw Error('站点登记信息不一致，停止构建');
const { buildContent } = await import('../modules/local-mvp/publish.ts');
const content = await buildContent();
const fields = ['id','title','sourceName','url','publishedAt','updatedAt','summary','points','materialNote','collectionApproved','features'];
const published = { total: content.total, sections: content.sections, updatedAt: content.updatedAt, revision: content.revision,
  items: content.items.map(a => Object.fromEntries(fields.map(k => [k, a[k]]))) };
await fs.mkdir(output, {recursive:true});
let html = await fs.readFile(path.join(repo, 'site/preview/index.html'), 'utf8');
html = html.replace('<title>内容试读 · Amazon营销与AI</title>', '<title>Amazon 营销与 AI</title>')
  .replace('>内容试读<span', '>Amazon 营销与 AI<span')
  .replace('href="/style.css"', 'href="./style.css"').replace('src="/app.js"', 'src="./app.js"')
  .replace('<meta name="color-scheme"', '<meta name="description" content="聚焦Amazon广告、营销、流量与AI的行业动态、教程、案例和工具。"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme"');
await fs.writeFile(path.join(output, 'index.html'), html);
for (const file of ['app.js','style.css','curation.js']) await fs.copyFile(path.join(repo, 'site/preview', file), path.join(output, file));
await fs.writeFile(path.join(output, 'content.json'), JSON.stringify(published) + '\n');
await fs.writeFile(path.join(output, 'runtime.json'), JSON.stringify({mode:'hosted',live:false,contentMode:'published-snapshot'}) + '\n');
await fs.writeFile(path.join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
await fs.writeFile(path.join(checkout, 'README.md'), '# Amazon 营销与 AI\n\n本项目的独立托管页面，仅站点所有者可访问。\n\n内容与阅读逻辑来自 https://github.com/jasmineztoh/amazon-ads-hot ，当前发布采用已整理的摘要和原文链接，不包含原文全文、采集队列、用户标注和密钥。\n\n源码由主仓库的 scripts/build-site.mjs 生成，再使用 Sites 发布流程保存和部署。\n');
console.log(JSON.stringify({checkout,output,articles:published.total,files:(await fs.readdir(output)).sort()}));
process.exit(0);
