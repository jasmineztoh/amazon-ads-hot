// 本地试读规则；偏好来自用户，特征判定与同档排序是Agent提出的试行方案。
export const SECTIONS = ['行业动态', '教程（新人入门与进阶）', '案例', '工具', 'AI营销'] as const;
export type Section = typeof SECTIONS[number];
export type Features = {
  sections: Section[];
  adPractice?: boolean;
  aiAdsWorkflow?: boolean;
  promotionLed?: boolean;
  softwareOnly?: boolean;
  productCategory?: string;
  eventGroup?: string;
};
export type Article = {
  id: string; title: string; sourceName: string; summary: string; points: string[];
  url: string; publishedAt: string; updatedAt: string | null; materialNote: string;
  collectionApproved: boolean; features: Features;
};
export function priority(a: Article): { tier: number; label: string; reason: string } {
  if (a.features.softwareOnly) return { tier: 0, label: '稍后看', reason: '侧重纯软件技术，保留收录，降低推荐顺序。' };
  if (a.features.promotionLed) return { tier: 0, label: '稍后看', reason: '主要介绍或推广自家产品，保留收录，降低推荐顺序。' };
  if (a.features.aiAdsWorkflow) return { tier: 2, label: '优先看', reason: '包含AI与广告工作流的具体用法。' };
  if (a.features.adPractice) return { tier: 2, label: '优先看', reason: '聚焦广告效果、打法或分析。' };
  return { tier: 1, label: '', reason: '按原文时间排列；没有替用户补写逐篇优先级。' };
}
export function feed(articles: Article[], options: { section?: string; query?: string; sort?: string } = {}) {
  const query = (options.query || '').trim().toLocaleLowerCase();
  const approved = articles.filter(a => a.collectionApproved);
  const eligible = approved.filter(a => (!options.section || a.features.sections.includes(options.section as Section)) &&
    (!query || [a.title, a.summary, a.sourceName, ...a.points].join(' ').toLocaleLowerCase().includes(query)));
  const byDate = (a: Article, b: Article) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id);
  const compare = (a: Article, b: Article) => options.sort === 'date' ? byDate(a, b) : priority(b).tier - priority(a).tier || byDate(a, b);
  eligible.sort(compare);
  const used = new Set<string>();
  const groups: { article: Article; related: Article[] }[] = [];
  for (const a of eligible) {
    const key = a.features.eventGroup || a.id;
    if (used.has(key)) continue;
    used.add(key);
    groups.push({ article: a, related: approved.filter(b => b.id !== a.id && a.features.eventGroup && b.features.eventGroup === a.features.eventGroup).sort(compare) });
  }
  // 仅在同一优先档内错开相邻的相同品类；未知/综合品类不视为同一品类。
  if (options.sort !== 'date') for (let i = 1; i < groups.length; i++) {
    const previous = groups[i - 1].article, current = groups[i].article;
    if (!previous.features.productCategory || previous.features.productCategory !== current.features.productCategory) continue;
    const j = groups.findIndex((g, index) => index > i && priority(g.article).tier === priority(current).tier &&
      g.article.features.productCategory && g.article.features.productCategory !== previous.features.productCategory);
    if (j >= 0) groups.splice(i, 0, groups.splice(j, 1)[0]);
  }
  return { matchingArticles: eligible.length, groups };
}
