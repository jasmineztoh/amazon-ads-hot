export const SECTIONS = ['行业动态', '教程', '案例', '工具', 'AI营销'] as const;

type Classification = { sections: string[]; aiTags?: string[]; tutorialTags?: string[] };
export function classify(input: Record<string, unknown>, aiNames: readonly string[], tutorialNames: ReadonlySet<string>, previous?: Classification) {
  const tags = (value: unknown, allowed: (tag: string) => boolean, limit: number, label: string) => {
    if (!Array.isArray(value) || value.length > limit || value.some(tag => typeof tag !== 'string' || !allowed(tag))) throw Error(`${label}无效`);
    return [...new Set(value)] as string[];
  };
  const aiTags = tags(input.aiTags ?? previous?.aiTags ?? [], tag => aiNames.includes(tag), 4, 'AI标签');
  const tutorialTags = tags(input.tutorialTags ?? previous?.tutorialTags ?? [], tag => tutorialNames.has(tag), 5, '教程标签');
  let selected: unknown;
  if (input.sections !== undefined) selected = input.sections;
  else if (input.section !== undefined) selected = [input.section, ...(previous?.sections ?? [])];
  else selected = previous?.sections ?? ['行业动态'];
  const sections = tags(selected, tag => (SECTIONS as readonly string[]).includes(tag), 5, '栏目');
  if (!sections.length) throw Error('至少选择一个栏目');
  if (sections.includes('AI营销') && !aiTags.length) throw Error('AI营销需要已确认的AI业务应用标签');
  if (aiTags.length && !sections.includes('AI营销')) sections.push('AI营销');
  if (tutorialTags.length && !sections.includes('教程')) sections.push('教程');
  return { sections, aiTags, tutorialTags };
}

type DatedItem = { id: string; title: string; publishedAt: string; collectedAt?: string; features: { sections: string[] } };
export function sectionStatus(items: DatedItem[], now = Date.now()) {
  return SECTIONS.map(section => {
    const rows = items.filter(item => item.features.sections.includes(section));
    const latest = [...rows].sort((a,b) => (b.collectedAt || '').localeCompare(a.collectedAt || ''))[0];
    return { section, count: rows.length, latestCollectedAt: latest?.collectedAt ?? null,
      latestPublishedAt: rows.map(item => item.publishedAt).sort().at(-1) ?? null,
      latestTitle: latest?.title ?? null,
      recentCount: rows.filter(item => { const time = Date.parse(item.publishedAt); return time <= now && time > now - 7 * 86400_000; }).length };
  });
}

export const updatePolicy = '每日检查全部信源，按原文内容覆盖行业动态、教程、案例、工具和AI营销，不能只更新全部页。先看各栏目最近收录时间和未发布候选，优先处理积压；同文可进入多个确实相关的栏目，使用sections数组或主栏目配合教程/AI标签。新工具及其操作方法可同时进入工具和教程，真实效果案例进入案例，业务AI应用加AI标签。逐篇核实原文和发布日期，评分后发布。发布后逐栏目回读数量、最近收录日期及新文章；有合格新材料的栏目必须更新，无新材料如实报告，禁止修改旧文日期或错分凑数。';
