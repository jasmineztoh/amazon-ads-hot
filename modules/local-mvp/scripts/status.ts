import fs from 'node:fs/promises';
import { loadStore, atomicJson } from '../store.ts';
import { SOURCES_FILE, WINDOW_DAYS, CHECK_INTERVAL_MINUTES } from '../collect.ts';
import type { Source } from '../types.ts';

const store = await loadStore(), now = new Date();
const sources: Source[] = JSON.parse(await fs.readFile(SOURCES_FILE, 'utf8'));
const ageHours = (date?: string | null) => date && Number.isFinite(Date.parse(date)) ? Math.max(0, Math.round((+now - Date.parse(date)) / 3_600_000 * 10) / 10) : null;
const report = {
  checkedAt: now.toISOString(), windowDays: WINDOW_DAYS, intervalMinutes: CHECK_INTERVAL_MINUTES,
  note: '本地采集状态；订阅最早日期不证明历史完整，检查成功不代表英文已整理或线上已更新。',
  sources: sources.map(source => {
    const health = store.sources[source.id];
    const entries = Object.values(store.entries).filter(e => e.sourceId === source.id);
    const pending = entries.filter(e => e.status === 'pending');
    const checkAge = ageHours(health?.successAt);
    return { id: source.id, name: source.name, lastCheck: health?.attemptedAt || null, lastSuccess: health?.successAt || null,
      checkOverdue: checkAge === null || checkAge > CHECK_INTERVAL_MINUTES / 60,
      error: health?.error || null, latestListed: health?.latestPublishedAt || null,
      daysSinceLatest: health?.latestPublishedAt ? Math.floor((ageHours(health.latestPublishedAt) || 0) / 24) : null,
      earliestListed: health?.earliestListedAt || null, listed: health?.candidates || 0, recentListed: health?.recentCandidates || 0,
      awaitingBody: pending.filter(e => !e.bodyHash).length,
      awaitingReview: pending.filter(e => e.bodyHash && !e.error).length,
      awaitingDate: pending.filter(e => !e.publishedAt).length,
      oldestPendingHours: pending.length ? Math.max(...pending.map(e => ageHours(e.firstSeenAt) || 0)) : null,
      materialErrors: entries.filter(e => e.status === 'material_error').map(e => ({ id: e.id, url: e.url, reason: e.error })),
      future: entries.filter(e => e.status === 'future').length,
      published: entries.filter(e => e.status === 'published').length };
  })
};
const output = process.argv.indexOf('--output');
if (output >= 0) { if (!process.argv[output + 1]) throw Error('缺少输出路径'); await atomicJson(process.argv[output + 1], report); }
console.log(JSON.stringify(report, null, 2));
process.exit(0);
