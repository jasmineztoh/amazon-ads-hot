import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
const objects=new Map<string,{text:string;etag:string}>();
let serial=0;
const bucket={
  async get(key:string){const x=objects.get(key);return x ? {etag:x.etag,text:async()=>x.text}:null;},
  async put(key:string,text:string,options:any={}) {
    const old=objects.get(key), condition=options.onlyIf;
    if (condition instanceof Headers && old) return null;
    if (condition?.etagMatches && old?.etag!==condition.etagMatches) return null;
    objects.set(key,{text,etag:String(++serial)});return {etag:String(serial)};
  },
  async delete(key:string){objects.delete(key);},
};
const env={BUCKET:bucket,MODEL_CALLS_ENABLED:'true',DEEPSEEK_API_KEY:'local-test-only',MODEL_DAILY_CALL_LIMIT:'60'};
(globalThis as any).__testCloudEnv=env;
const hooks=registerHooks({
  resolve(specifier,context,next){
    if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__testCloudEnv',shortCircuit:true};
    if(specifier.startsWith('./') && !/\.[a-z]+$/.test(specifier))return next(specifier+'.ts',context);
    return next(specifier,context);
  },
  load(url,context,next){if(url.endsWith('.json'))return {format:'module',source:'export default '+readFileSync(new URL(url),'utf8'),shortCircuit:true};return next(url,context);}
});
const {assess}=await import('./deepseek.ts');
test('评分独立调用两次，缓存成功回执；无效评分和额度不足留下失败记录',async()=>{
  const previousFetch=globalThis.fetch;let requests:any[]=[];
  const input={url:'https://example.com/a',title:'new event',body:'Verified original material. '.repeat(30),sourceTime:null,participant:'one',sourceName:'one'};
  try {
    const answers=[{attentionScore:81},{attentionScore:84},{kind:'event',title:'具体事件标题',eventId:null}];
    globalThis.fetch=async (_url,init)=>{requests.push(JSON.parse(String(init?.body)));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answers.shift())}}],usage:{total_tokens:100}});};
    const first=await assess(input,[]);
    assert.equal(first.score,82);assert.deepEqual(first.scores,[81,84]);
    assert.deepEqual(requests[0].messages,requests[1].messages);
    await assess(input,[]);assert.equal(requests.length,3);
    assert.equal([...objects].filter(([k,v])=>k.includes('receipts')&&JSON.parse(v.text).status==='succeeded').length,3);
    objects.clear();requests=[];
    globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"attentionScore":101}'}}]});
    await assert.rejects(assess(input,[]),/评分格式/);
    assert.ok([...objects.values()].some(v=>v.text.includes('"status":"failed"')));
    objects.clear();env.MODEL_DAILY_CALL_LIMIT='1';let paid=0;
    globalThis.fetch=async()=>{paid++;return Response.json({choices:[{finish_reason:'stop',message:{content:'{"attentionScore":80}'}}]});};
    await assert.rejects(assess(input,[]),/调用上限/);assert.equal(paid,1);
  } finally {globalThis.fetch=previousFetch;hooks.deregister();delete (globalThis as any).__testCloudEnv;}
});
