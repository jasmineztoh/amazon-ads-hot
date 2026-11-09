import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankHot, type HotArticle, type Assessment} from './hot-ranking.ts';
const now=Date.parse('2026-11-09T12:00:00Z');
function article(id:string,participant:string,hours=0):HotArticle {
  return {id,title:id,url:`https://example.com/${id}`,collectionApproved:true,assessment:{
    eventId:'launch',eventTitle:'发布新功能',kind:'event',sourceTime:new Date(now-hours*3600_000).toISOString(),
    participant,sourceName:participant,url:`https://example.com/${id}`,score:81,scores:[80,82],
    model:'test',promptVersion:'v1',bodyHash:id,assessedAt:new Date(now).toISOString(),receipts:['1','2','3']} satisfies Assessment};
}
test('同参与方重复报道不加热度；24小时衰减一半',()=>{
  const rows=rankHot([article('a','one'),article('b','two',24),article('c','one',1)],now);
  assert.equal(rows.length,1);assert.equal(rows[0].heat,15);assert.equal(rows[0].participants.length,2);
});
test('单来源、过期、未来、未评分、撤回和常青教程不进入实时热点',()=>{
  const old=article('old','two',48),future=article('future','two',-1),tutorial=article('tutorial','two');
  tutorial.assessment!.kind='evergreen';const withdrawn=article('withdrawn','two');withdrawn.collectionApproved=false;
  const unknown=article('unknown','two');unknown.assessment!.sourceTime=null;
  assert.deepEqual(rankHot([article('a','one'),old,future,tutorial,withdrawn,unknown],now),[]);
});
