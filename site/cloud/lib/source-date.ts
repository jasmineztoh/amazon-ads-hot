// Lists commonly expose a local calendar day while article metadata uses UTC.
export function sourceDateMatches(listed: string, verified: string) {
  const a = Date.parse(listed.slice(0,10)), b = Date.parse(verified.slice(0,10));
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 86400_000;
}
