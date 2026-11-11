type Item = { id: string; aiTags?: string[]; features: { sections: string[] } };
type Config = { tags: string[]; articles: Record<string, string[]> };

export function applyAiMarketing<T extends Item>(items: T[], config: Config) {
  return items.map(item => {
    const aiTags = (config.articles[item.id] ?? item.aiTags ?? []).filter(tag => config.tags.includes(tag));
    const sections = item.features.sections.filter(section => section !== 'AI营销');
    if (aiTags.length) sections.push('AI营销');
    return { ...item, aiTags, features: { ...item.features, sections: sections.length ? sections : ['行业动态'] } };
  });
}
