import { fileURLToPath } from 'node:url';
import { collectOnce } from './collect.ts';
import { publishSnapshot, buildContent } from './publish.ts';
import { atomicJson } from './store.ts';
export async function startUpdates() {
  let running: Promise<void> | null = null;
  let stopped = false;
  const update = () => {
    if (stopped || running) return running;
    running = (async () => {
      try {
        const run = await collectOnce(); await publishSnapshot(); const content = await buildContent();
        await atomicJson(fileURLToPath(new URL('../../site/preview/content.json', import.meta.url)), content);
        console.log(JSON.stringify({ event: 'content-updated', total: content.total, newEntries: run.newEntries, failures: run.failures, at: content.updatedAt }));
      } catch (e) { console.error(JSON.stringify({ event: 'update-failed', error: (e as Error).message })); }
    })().finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(update, 120 * 60_000);
  void update();
  return { stop: async () => { stopped = true; clearInterval(timer); await running; } };
}
