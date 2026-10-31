import type { Features, Article } from '../../industry/curation.ts';
export type Source = { id: string; name: string; kind: 'rss' | 'web_list' | 'amazon_updates'; url: string; host: string; articleHost?: string; audioDescriptionOnly?: boolean; language: string; bodyLimit: number; list?: { itemSelector: string; linkSelector?: string; titleSelector?: string; publishedAtSelector?: string; publishedAtRegex?: string; allowUrlPrefixes?: string[] } };
export type Entry = {
  id: string; key: string; url: string; sourceId: string; sourceName: string; originalTitle: string;
  excerpt: string; publishedAt: string | null; firstSeenAt: string; lastSeenAt: string;
  status: 'baseline' | 'pending' | 'published' | 'excluded' | 'future' | 'old' | 'material_error';
  bodyHash: string | null; bodyChars: number; bodyFile: string | null; checkedAt: string | null;
  pageDate: string | null; error: string | null;
  bodyVia?: 'rss' | 'page';
  publication?: Article & { origin: 'publisher-summary' | 'agent-reviewed'; evidenceHash: string; reviewedAt: string };
};
export type SourceHealth = { id: string; name: string; attemptedAt: string; successAt: string | null; candidates: number; error: string | null; latestPublishedAt?: string | null; earliestListedAt?: string | null; recentCandidates?: number };
export type Run = { startedAt: string; finishedAt: string; discovered: number; newEntries: number; duplicateEntries: number; bodies: number; published: number; failures: number; sources: SourceHealth[] };
export type Store = { version: 1; entries: Record<string, Entry>; sources: Record<string, SourceHealth>; runs: Run[] };
export type Edit = { id: string; evidenceHash: string; decision: 'publish' | 'exclude'; title?: string; summary?: string; points?: string[]; materialNote: string; features?: Features; reviewedAt: string; reviewedBy: 'Agent' };
