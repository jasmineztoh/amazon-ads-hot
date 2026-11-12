// Adapted from AIHOT packages/backend/src/events/hot.ts at upstream e7dba13.
// Keep the original participant deduplication and 10x scale, with a longer window for this market.
export const HOT_WINDOW_DAYS = 7;
export const HOT_HALF_LIFE_HOURS = 72;
export type Assessment = {
  eventId: string | null; eventTitle: string; kind: 'event' | 'evergreen';
  sourceTime: string | null; participant: string; sourceName: string; url: string;
  score: number; scores: [number, number]; model: string; promptVersion: string;
  bodyHash: string; assessedAt: string; receipts: string[];
};
export type HotArticle = { id: string; title: string; url: string; collectionApproved: boolean; sourceRole?: string; assessment?: Assessment };
export function rankHot(items: HotArticle[], now = Date.now()) {
  const events = new Map<string, HotArticle[]>();
  for (const item of items) {
    const a = item.assessment, at = Date.parse(a?.sourceTime || '');
    if (!item.collectionApproved || !a || a.kind !== 'event' || !a.eventId ||
      !Number.isFinite(at) || at > now || at <= now - HOT_WINDOW_DAYS * 24 * 3600_000) continue;
    events.set(a.eventId, [...(events.get(a.eventId) || []), item]);
  }
  return [...events].flatMap(([eventId, reports]) => {
    const participants = new Map<string, HotArticle>();
    for (const item of reports) {
      const a = item.assessment!, previous = participants.get(a.participant)?.assessment;
      if (!previous || Date.parse(a.sourceTime!) > Date.parse(previous.sourceTime!)) participants.set(a.participant, item);
    }
    if (participants.size < 2) return [];
    const heat = Math.round([...participants.values()].reduce((sum, item) =>
      sum + 0.5 ** ((now - Date.parse(item.assessment!.sourceTime!)) / 3600_000 / HOT_HALF_LIFE_HOURS), 0) * 100) / 10;
    const representative = [...reports].sort((a,b) => Number(b.sourceRole==='official') - Number(a.sourceRole==='official') || b.assessment!.score - a.assessment!.score || a.id.localeCompare(b.id))[0];
    return [{ eventId, itemId: representative.id, title: representative.assessment!.eventTitle,
      heat, score: representative.assessment!.score, latestAt: Math.max(...reports.map(x => Date.parse(x.assessment!.sourceTime!))),
      participants: [...participants.values()].map(x => ({ name: x.assessment!.sourceName, url: x.url })),
      // Without continuous source clocks, a six-hour arrow would be unverified.
      trend: 'unknown' as const }];
  }).sort((a,b) => b.heat - a.heat || b.latestAt - a.latestAt).slice(0,10)
    .map((entry,index) => ({ ...entry, rank: index + 1 }));
}
