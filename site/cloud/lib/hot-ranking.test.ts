import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankHot, type HotArticle, type Assessment} from './hot-ranking.ts';
const now=Date.parse('2026-11-17T12:00:00Z');
function article(id:string,hours=0):HotArticle {
  return {id,title:id,url:`https://example.com/${id}`,collectionApproved:true,publishedAt:new Date(now-hours*3600_000).toISOString(),assessment:{
    eventId:id,eventTitle:id,kind:'event',sourceTime:null,
    participant:'example.com',sourceName:'Example',url:`https://example.com/${id}`,score:81,scores:[80,82],
    model:'test',promptVersion:'v1',bodyHash:id,assessedAt:new Date(now).toISOString(),receipts:['1','2','3']} satisfies Assessment};
}
test('single-source articles with verified publication dates fill five weekly slots',()=>{
  const items=Array.from({length:8},(_,i)=>article(String(i),i*24));
  const rows=rankHot(items,now);assert.equal(rows.length,5);assert.equal(rows[0].itemId,'0');
  assert.deepEqual(rows.map(x=>x.rank),[1,2,3,4,5]);
});
test('duplicate participant coverage does not inflate ranking',()=>{
  const a=article('a'),b=article('b');b.assessment!.eventId='a';
  const rows=rankHot([a,b],now);assert.equal(rows.length,1);
  assert.equal(rows[0].heat,rankHot([a],now)[0].heat);
  assert.equal(rows[0].participants.length,1);
});
test('recent evergreen articles qualify; unknown dates, future, old and withdrawn do not',()=>{
  const tutorial=article('tutorial');tutorial.assessment!.kind='evergreen';tutorial.assessment!.eventId=null;
  const unknown=article('unknown');delete unknown.publishedAt;
  const withdrawn=article('withdrawn');withdrawn.collectionApproved=false;
  assert.deepEqual(rankHot([tutorial,unknown,withdrawn,article('old',168),article('future',-1)],now).map(x=>x.itemId),['tutorial']);
});
test('unscored approved articles retain null value and do not invent AI scores',()=>{
  const a=article('a');delete a.assessment;
  assert.equal(rankHot([a],now)[0].score,null);
});
test('value and freshness determine ranking; ties are deterministic',()=>{
  const a=article('a'),b=article('b');a.assessment!.score=20;
  assert.equal(rankHot([a,b],now)[0].itemId,'b');
  assert.equal(rankHot([article('b'),article('a')],now)[0].itemId,'a');
});
