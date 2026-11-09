import { env } from 'cloudflare:workers';
import { readJson, writeJson } from './daily-store';
import prompts from '../data/scoring-prompts.json';
import type { Assessment } from './hot-ranking';

type Config = { DEEPSEEK_API_KEY?: string; DEEPSEEK_MODEL?: string; MODEL_CALLS_ENABLED?: string; MODEL_DAILY_CALL_LIMIT?: string };
const config = () => env as typeof env & Config;
export const modelReady = () => config().MODEL_CALLS_ENABLED === 'true' && !!config().DEEPSEEK_API_KEY;
export async function hashText(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(x => x.toString(16).padStart(2,'0')).join('');
}
export const assessmentKey = async (url: string) => `daily/assessments/${await hashText(url)}.json`;
export async function recentAssessments(): Promise<Assessment[]> {
  const listed = await env.BUCKET!.list({prefix:'daily/assessments/',limit:1000});
  if (listed.truncated) throw Error('评分记录超过单批容量，需要分页读取后再归组');
  const entries = await Promise.all(listed.objects.map(x=>readJson<Assessment|null>(x.key,null)));
  return entries.filter((x):x is Assessment=>!!x && Date.parse(x.assessedAt)>Date.now()-7*86400_000);
}

// R2 conditional writes reserve a call before it can be charged. A crashed attempt still uses its slot.
async function reserveCall() {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  const key = `daily/model-budget/${day}.json`, bucket = env.BUCKET!;
  const previous = await bucket.get(key);
  const used = previous ? JSON.parse(await previous.text()).used : 0;
  const limit = Number(config().MODEL_DAILY_CALL_LIMIT || 60);
  if (!Number.isInteger(limit) || limit < 1 || used >= limit) throw Error('模型每日调用上限已到，待下一日或调整上限');
  const result = await bucket.put(key, JSON.stringify({used:used+1}), {
    onlyIf: previous ? {etagMatches:previous.etag} : new Headers({'If-None-Match':'*'}) });
  if (!result) throw Error('另一个评分任务正在预留额度，请稍后重试');
}
async function callModel(system: string, input: string, purpose: string, validate: (value:any)=>void) {
  if (!modelReady()) throw Error('DeepSeek尚未配置或启用');
  const model = config().DEEPSEEK_MODEL || 'deepseek-flash';
  const id = await hashText(JSON.stringify([model,system,input,purpose]));
  const key = `daily/model-receipts/${id}.json`;
  const prior = await readJson<any>(key,null);
  if (prior?.status === 'succeeded') { validate(prior.output); return {id,output:prior.output}; }
  const lock = await env.BUCKET!.put(`${key}.lock`, new Date().toISOString(), {onlyIf:new Headers({'If-None-Match':'*'})});
  if (!lock) throw Error('此评分已有运行中的请求，请先检查回执，避免重复计费');
  const startedAt = new Date().toISOString();
  try {
    await reserveCall();
    await writeJson(key,{status:'started',model,purpose,startedAt});
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method:'POST',headers:{Authorization:`Bearer ${config().DEEPSEEK_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:input}],
        response_format:{type:'json_object'},thinking:{type:'disabled'},max_tokens:2000,temperature:1}),
      signal:AbortSignal.timeout(90_000) });
    if (!response.ok) throw Error(`DeepSeek HTTP ${response.status}`);
    const result = await response.json() as any;
    if (result.choices?.[0]?.finish_reason !== 'stop') throw Error('模型响应未完整结束');
    const output = JSON.parse(result.choices[0].message.content);
    validate(output);
    await writeJson(key,{status:'succeeded',model,purpose,startedAt,finishedAt:new Date().toISOString(),output,usage:result.usage});
    return {id,output};
  } catch(error) {
    const failure={status:'failed',model,purpose,startedAt,finishedAt:new Date().toISOString(),error:String((error as Error).message).slice(0,300)};
    await writeJson(key,failure);
    await writeJson(`daily/model-failures/${id}/${crypto.randomUUID()}.json`,failure);
    throw error;
  } finally { await env.BUCKET!.delete(`${key}.lock`); }
}

export async function assess(input: {url:string;title:string;body:string;sourceTime:string|null;participant:string;sourceName:string}, existing: Assessment[]) {
  if (input.body.length < 200 || input.body.length > 60000) throw Error('评分需要200至60000字的已核实原文材料');
  if (!modelReady()) throw Error('DeepSeek尚未配置或启用');
  const bodyHash=await hashText(input.body), promptVersion=await hashText(JSON.stringify(prompts));
  const prior=await readJson<Assessment|null>(await assessmentKey(input.url),null);
  if (prior && prior.bodyHash===bodyHash && prior.promptVersion===promptVersion && prior.sourceTime===input.sourceTime &&
      prior.participant===input.participant && prior.model===(config().DEEPSEEK_MODEL || 'deepseek-flash')) return prior;
  const material = JSON.stringify({title:input.title,publishedAt:input.sourceTime,body:input.body});
  const validateScore = (v:any) => { if (!Number.isInteger(v.attentionScore) || v.attentionScore<0 || v.attentionScore>100 || Object.keys(v).length!==1) throw Error('AI评分格式无效'); };
  const a = await callModel(prompts.score,material,'score-1',validateScore);
  const b = await callModel(prompts.score,material,'score-2',validateScore);
  const candidates = [...new Map(existing.filter(x=>x.eventId && x.sourceTime && Date.parse(x.sourceTime)>Date.now()-7*86400_000).map(x=>[x.eventId,{eventId:x.eventId,title:x.eventTitle}])).values()];
  const group = await callModel(prompts.group,JSON.stringify({material:JSON.parse(material),events:candidates}),'structure',(v:any)=>{
    if (!['event','evergreen'].includes(v.kind) || typeof v.title!=='string' || v.title.length<4 || v.title.length>150 ||
      (v.eventId!==null && !candidates.some(x=>x.eventId===v.eventId))) throw Error('事件归组格式无效');
  });
  const scores:[number,number]=[a.output.attentionScore,b.output.attentionScore];
  const result:Assessment={eventId:group.output.kind==='event' ? group.output.eventId || await hashText(input.url) : null,
    eventTitle:group.output.title,kind:group.output.kind,sourceTime:input.sourceTime,participant:input.participant,
    sourceName:input.sourceName,url:input.url,score:Math.floor((scores[0]+scores[1])/2),scores,
    model:config().DEEPSEEK_MODEL || 'deepseek-flash',promptVersion,
    bodyHash,assessedAt:new Date().toISOString(),receipts:[a.id,b.id,group.id]};
  await writeJson(await assessmentKey(input.url),result);
  return result;
}
