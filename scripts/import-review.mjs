import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const dir = 'docs/精选校准';
const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const write = (p, x) => fs.writeFile(p, JSON.stringify(x, null, 2) + '\n');
const sha = text => createHash('sha256').update(text).digest('hex');
const raw = await fs.readFile(`${dir}/待标文章.md`, 'utf8');
const hash = sha(raw);
await fs.mkdir('.data/selection/user-input', { recursive: true });
await fs.writeFile(`.data/selection/user-input/${hash}.md`, raw);
const previous = await read(`${dir}/标记.json`);
const development = await read(`${dir}/文章.json`);
const holdout = await read(`${dir}/验证集.json`);
const all = [...development.articles, ...holdout.articles];
const sections = [...raw.matchAll(/^### (\d{3})｜[^\r\n]+\r?\n([\s\S]*?)(?=^### |^## 第|$(?![\s\S]))/gm)];
if (sections.length !== 48 || new Set(sections.map(s => s[1])).size !== 48) throw Error('应有48篇唯一文章');
const remarks = {
  '038': { direction: 'lower', condition: '文章重点在推广自家产品时', scope: 'conditional' },
  '042': { direction: 'higher', condition: '广告效果、打法与分析', scope: 'preference' },
  '043': { direction: 'diversify', condition: '覆盖不同商品品类', scope: 'portfolio' },
  '044': { direction: 'higher', condition: 'AI与广告的工作流自动化', scope: 'preference' },
  '047': { direction: 'lower', condition: '只涉及纯软件、技术知识', scope: 'preference' },
};
const labels = sections.map(s => {
  const parsed = s[2].match(/\*\*你的标记：\*\*\s*([\s\S]*?)\*\*理由：\*\*([\s\S]*?)$/);
  if (!parsed) throw Error(`缺少标记 ${s[1]}`);
  const rawMark = parsed[1].trim(), reason = parsed[2].trim() || null;
  if (!['要', '要标'].includes(rawMark)) throw Error(`未处理的标记 ${s[1]} ${rawMark}`);
  const old = previous.labels.find(l => l.number === s[1]);
  if (old && (old.rawMark !== rawMark || old.reason !== reason)) throw Error(`旧标记已变更，需保留变更历史 ${s[1]}`);
  return old || {
    caseId: `article-${s[1]}`, number: s[1], decision: 'select', decisionScope: 'collection',
    featuredDecision: null, rawMark, reason, labeledAt: '2026-10-29',
    readingBasis: '未说明是否逐篇阅读全文；已审阅本轮阅读材料',
    evidence: { file: `${dir}/待标文章.md`, sourceFileSha256: hash, globalConfirmation: '本轮仍然没有淘汰的文章，但是部分内容做了优先级划分和理由说明' },
    normalization: null, priorityPreference: remarks[s[1]] || null,
  };
});
if (labels.filter(l => l.reason).length !== 5) throw Error('本轮应有5条用户原话');
const manifests = await read('.data/selection/manifest.json');
const gold = [];
for (const a of all) {
  const l = labels.find(l => l.caseId === a.caseId);
  const m = manifests.find(m => m.caseId === a.caseId);
  const body = await fs.readFile(m.bodyFile, 'utf8');
  if (sha(body) !== a.snapshot.bodySha256) throw Error(`正文快照变化 ${a.caseId}`);
  a.human = { decision: 'select', decisionScope: 'collection', featuredDecision: null, rawMark: l.rawMark,
    reason: l.reason, priorityPreference: l.priorityPreference || null, labeledAt: l.labeledAt, readingBasis: l.readingBasis };
  gold.push({ caseId: a.caseId, material: { title: a.title, originalTitle: a.originalTitle, publishedAt: a.publishedAt,
    sourceName: a.sourceName, bodyZh: a.language === 'zh' ? body : null, bodyOriginal: a.language === 'zh' ? null : body },
    sourceFacts: a.sourceFacts, samplingContext: { ...a.samplingContext, labelScope: 'collection', currentUse: 'development' },
    gold: { decision: 'select' }, annotation: { decisionScope: 'collection', rawMark: l.rawMark, reason: l.reason,
      priorityPreference: l.priorityPreference || null, readingBasis: l.readingBasis, evidence: l.evidence } });
}
await write(`${dir}/标记.json`, { ...previous, version: '2026-10-29-v2', status: '48篇全部完成；5条偏好说明；无拒收例',
  meaning: '全部允许收录；优先级偏好与逐篇首页精选许可分开记录；不表示事实背书',
  globalConfirmation: '我已经在待标文章里全部做好了标记，所有的都已经标注完成。本轮仍然没有淘汰的文章，但是部分内容做了优先级划分和理由说明', labels,
  rounds: [{ range: '001—036', outcome: '全部允许收录；理由空白' }, { range: '037—048', outcome: '全部允许收录；5条偏好说明', sourceFileSha256: hash }] });
development.status = '36篇收录完成；与已标12篇共同用于新版规则开发';
holdout.status = '12篇标注完成；已用于v2修订，不再作为未见验证集';
holdout.scope = '保留原分组与冻结初判；当前用于规则开发';
await write(`${dir}/文章.json`, development);
await write(`${dir}/验证集.json`, holdout);
await write('docs/收录池.json', { version: '2026-10-29-v2', status: '48篇用户允许收录的静态内容池；供本地试读，未导入应用数据库',
  approvedBy: '用户', approvedAt: '2026-10-29', approvalScope: 'collection', total: all.length,
  items: all.map(a => ({ id: a.caseId, title: a.title, sourceName: a.sourceName, sourceId: a.sourceId, url: a.url,
    publishedAt: a.publishedAt, updatedAt: a.updatedAt, format: a.format, summary: a.summary, points: a.points,
    materialNote: a.materialNote, collectionApproved: true, featuredDecision: null, editorialTextReviewed: false })) });
await fs.writeFile('.data/gold.collection.jsonl', gold.map(x => JSON.stringify(x)).join('\n') + '\n');
const archive = `${dir}/收录标准-v1.md`;
try { await fs.access(archive); } catch { await fs.copyFile('docs/收录标准.md', archive); }
console.log(JSON.stringify({ labels: labels.length, reasons: labels.filter(l => l.reason).length, bodyHashesVerified: gold.length, backupHash: hash }));
