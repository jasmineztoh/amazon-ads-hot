import { collectOnce } from '../collect.ts';
import { publishSnapshot, buildContent } from '../publish.ts';
import { atomicJson } from '../store.ts';
import { fileURLToPath } from 'node:url';
try {
  if (!process.argv.includes('--export')) console.log(JSON.stringify(await collectOnce(), null, 2));
  await publishSnapshot();
  const content = await buildContent();
  await atomicJson(fileURLToPath(new URL('../../../site/preview/content.json', import.meta.url)), content);
  console.log(JSON.stringify({ total: content.total, groupedRows: content.groupedRows, updatedAt: content.updatedAt }));
} catch (e) { console.error((e as Error).stack); process.exitCode = 1; }
process.exit(process.exitCode || 0);
