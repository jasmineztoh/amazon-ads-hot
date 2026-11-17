import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceDateMatches } from './source-date.ts';
test('local publication day and following UTC day are consistent',()=> {
  assert.equal(sourceDateMatches('2026-11-13T00:00:00Z','2026-11-14T00:19:40Z'),true);
});
test('larger date conflicts and invalid dates remain rejected',()=> {
  assert.equal(sourceDateMatches('2026-11-13','2026-11-15T00:00:00Z'),false);
  assert.equal(sourceDateMatches('unknown','2026-11-14'),false);
});
