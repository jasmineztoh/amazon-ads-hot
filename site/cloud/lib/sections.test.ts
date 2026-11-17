import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, sectionStatus } from './sections.ts';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='cloudflare:workers') return {url:'data:text/javascript,export const env={};',shortCircuit:true};
  return nextResolve(specifier,context);
}});
const {recentCandidates} = await import('./daily-store.ts');
const ai = ['AI关键词调研', 'AI广告投放'];
const tutorials = new Set(['关键词与定向', '预算与竞价']);
test('one verified tool tutorial reaches all relevant sections', () => {
  assert.deepEqual(classify({section:'工具', tutorialTags:['关键词与定向'], aiTags:['AI关键词调研']}, ai, tutorials).sections, ['工具','AI营销','教程']);
});
test('explicit sections support news with a practical tutorial', () => {
  assert.deepEqual(classify({sections:['行业动态','教程']}, ai, tutorials).sections, ['行业动态','教程']);
});
test('legacy updates preserve existing secondary sections and tags', () => {
  assert.deepEqual(classify({section:'教程'}, ai, tutorials, {sections:['AI营销'],aiTags:['AI广告投放']}).sections, ['教程','AI营销']);
});
test('invalid or empty categories and unsupported tags fail visibly', () => {
  for (const input of [{sections:[]},{section:'全部'},{section:'AI营销'},{aiTags:['虚构标签']},{tutorialTags:['不存在']}]) assert.throws(()=>classify(input,ai,tutorials));
});
test('coverage is measured per section, with true dates retained', () => {
  const rows = sectionStatus([{id:'a',title:'新工具教程',publishedAt:'2026-11-16',collectedAt:'2026-11-17T08:00:00Z',features:{sections:['教程','工具']}}],Date.parse('2026-11-17T12:00:00Z'));
  assert.equal(rows.find(row=>row.section==='工具')?.recentCount,1);
  assert.equal(rows.find(row=>row.section==='教程')?.latestPublishedAt,'2026-11-16');
  assert.equal(rows.find(row=>row.section==='行业动态')?.latestCollectedAt,null);
});
test('new dated and retained unpublished candidates precede undated rediscoveries',()=> {
  const capturedAt=new Date().toISOString();
  const candidate=(url:string,publishedAt:string|null)=>({sourceId:'one',sourceName:'one',title:url,url,publishedAt,excerpt:'',capturedAt});
  const items=[candidate('https://example.com/undated',null),candidate('https://example.com/new',capturedAt),candidate('https://example.com/pending',capturedAt),candidate('https://example.com/new',capturedAt)];
  const result=recentCandidates([{checkedAt:capturedAt,sources:[],items}],2);
  assert.deepEqual(result.map(item=>item.url),['https://example.com/new','https://example.com/pending']);
});
