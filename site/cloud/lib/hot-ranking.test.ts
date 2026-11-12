import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankHot, HOT_WINDOW_DAYS, type HotArticle, type Assessment} from './hot-ranking.ts';
const now=Date.parse('2026-11-09T12:00:00Z');
function article(id:string,participant:string,hours=0):HotArticle {
  return {id,title:id,url:`https://example.com/${id}`,collectionApproved:true,assessment:{
    eventId:'launch',eventTitle:'发布新功能',kind:'event',sourceTime:new Date(now-hours*3600_000).toISOString(),
    participant,sourceName:participant,url:`https://example.com/${id}`,score:81,scores:[80,82],
    model:'test',promptVersion:'v1',bodyHash:id,assessedAt:new Date(now).toISOString(),receipts:['1','2','3']} satisfies Assessment};
}
test('同参与方重复报道不加热度；72小时衰减一半',()=>{
  const rows=rankHot([article('a','one'),article('b','two',72),article('c','one',1)],now);
  assert.equal(rows.length,1);assert.equal(rows[0].heat,15);assert.equal(rows[0].participants.length,2);
});
test('单来源、过期、未来、未评分、撤回和常青教程不进入实时热点',()=>{
  const old=article('old','two',HOT_WINDOW_DAYS*24),future=article('future','two',-1),tutorial=article('tutorial','two');
  tutorial.assessment!.kind='evergreen';const withdrawn=article('withdrawn','two');withdrawn.collectionApproved=false;
  const unknown=article('unknown','two');unknown.assessment!.sourceTime=null;
  assert.deepEqual(rankHot([article('a','one'),old,future,tutorial,withdrawn,unknown],now),[]);
});
test('亚马逊广告报道频率较低，同一事件跨过48小时仍可入榜',()=>{
  const rows=rankHot([article('a','one',60),article('b','two',70)],now);
  assert.equal(rows.length,1);
  assert.equal(rows[0].participants.length,2);
});
