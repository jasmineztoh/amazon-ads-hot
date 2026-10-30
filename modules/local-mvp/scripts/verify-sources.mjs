import fs from 'node:fs/promises';
import { listing,fetchPublic,dateState } from '../collect.ts';
import { readable } from '../../../packages/backend/src/content/extract.ts';
const catalog=JSON.parse(await fs.readFile('docs/信源.json','utf8')).sources;
const active=JSON.parse(await fs.readFile('industry/local-sources.json','utf8'));
const option=process.argv.indexOf('--candidates');
const ids=option<0?[]:(process.argv[option+1]||'').split(',').filter(Boolean);
const proposed=catalog.filter(s=>ids.includes(s.id)).map(s=>({id:s.id,name:s.name,kind:'rss',url:s.capture.url,host:new URL(s.capture.url).hostname.replace(/^www\./,''),language:'en',bodyLimit:3}));
const sources=[...new Map([...active,...proposed].map(s=>[s.id,s])).values()];const now=new Date().toISOString();const report=[];
await fs.mkdir('.data/source-check',{recursive:true});
await Promise.all(sources.map(async s=>{
 const r={id:s.id,name:s.name,url:s.url,host:s.host,active:active.some(x=>x.id===s.id),checkedAt:now,samples:[]};
 try {const items=await listing(s);const recent=items.filter(x=>x.publishedAt&&dateState(x.publishedAt,now)==='pending').sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
 Object.assign(r,{listed:items.length,recent:recent.length,latest:recent[0]?.publishedAt||null,old:items.filter(x=>dateState(x.publishedAt,now)==='old').length,future:items.filter(x=>dateState(x.publishedAt,now)==='future').length,undated:items.filter(x=>!x.publishedAt).length,earliest:items.filter(x=>x.publishedAt).map(x=>x.publishedAt).sort()[0]||null});
 for(const c of recent.slice(0,2)) {const sample={url:c.url,title:c.title,publishedAt:c.publishedAt};try {let body=c.feedBody;if(body)sample.via='rss';else {const page=await fetchPublic(c.url,s);const parsed=readable(page.text,page.url);if(!parsed)throw Error('正文不足');body=parsed.text;sample.via='page';sample.pageDate=parsed.publicationTime||null;}sample.bodyChars=body.length;await fs.writeFile('.data/source-check/'+s.id+'-'+r.samples.length+'.txt',body);}catch(e){sample.error=e.message;}r.samples.push(sample);}
 }catch(e){r.error=e.message;}report.push(r);console.log(JSON.stringify(r));
}));const outputIndex=process.argv.indexOf('--output');const output=outputIndex<0?'.data/source-check/report.json':process.argv[outputIndex+1];if(!output)throw Error('缺少输出路径');await fs.writeFile(output,JSON.stringify({checkedAt:now,windowDays:60,sources:report.sort((a,b)=>a.id.localeCompare(b.id))},null,2)+'\n');process.exit(0);
