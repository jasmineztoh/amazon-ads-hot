// Weekly editorial ranking; coverage is evidence, not a prerequisite for inclusion.
export const HOT_WINDOW_DAYS = 7;
export const HOT_HALF_LIFE_HOURS = 72;
export type Assessment = {
  eventId: string | null; eventTitle: string; kind: 'event' | 'evergreen';
  sourceTime: string | null; participant: string; sourceName: string; url: string;
  score: number; scores: [number, number]; model: string; promptVersion: string;
  bodyHash: string; assessedAt: string; receipts: string[];
};

export type HotArticle = { id: string; title: string; url: string; publishedAt?: string; collectionApproved: boolean; sourceName?: string; sourceRole?: string; features?: { eventGroup?: string }; assessment?: Assessment };
export function rankHot(items: HotArticle[], now = Date.now()) {
  const events = new Map<string, HotArticle[]>();
  const published = (item: HotArticle) => Date.parse(item.assessment?.sourceTime || item.publishedAt || '');
  for (const item of items) {
    const at = published(item);
    if (!item.collectionApproved || !Number.isFinite(at) || at > now || at <= now - HOT_WINDOW_DAYS * 86400_000) continue;
    const key = item.assessment?.eventId || item.features?.eventGroup || item.url.replace(/\?.*$/, '').replace(/\/$/, '');
    events.set(key, [...(events.get(key) || []), item]);
  }
  return [...events].map(([eventId, reports]) => {
    const participants = new Map<string, HotArticle>();
    for (const item of reports) {
      const key = item.assessment?.participant || new URL(item.url).hostname.replace(/^www\./, '');
      const previous = participants.get(key);
      if (!previous || published(item) > published(previous)) participants.set(key, item);
    }
    const representative = [...reports].sort((a,b) => (b.assessment?.score ?? -1) - (a.assessment?.score ?? -1) ||
      Number(b.sourceRole === 'official') - Number(a.sourceRole === 'official') || published(b) - published(a) || a.id.localeCompare(b.id))[0];
    const latestAt = Math.max(...reports.map(published));
    const score = representative.assessment?.score ?? null;
    // 70% assessed value, 30% freshness, up to ten points for independent coverage.
    const heat = Math.round(Math.min(100, (score ?? 0) * .7 + 30 * .5 ** ((now - latestAt) / 3600_000 / HOT_HALF_LIFE_HOURS) + Math.min(10, (participants.size - 1) * 5)));
    return { eventId, itemId: representative.id, title: representative.title, heat, score, latestAt,
      participants: [...participants.values()].map(x => ({ name: x.assessment?.sourceName || x.sourceName || new URL(x.url).hostname, url: x.url })),
      trend: 'unknown' as const };
  }).sort((a,b) => b.heat - a.heat || b.latestAt - a.latestAt || a.itemId.localeCompare(b.itemId)).slice(0,5)
    .map((entry,index) => ({ ...entry, rank: index + 1 }));
}
