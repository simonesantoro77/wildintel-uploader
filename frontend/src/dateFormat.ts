const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "4 Sep 2024" (or "4 Sep", without the year) from an ISO date or date-time — the same in every locale. */
export function formatDay(iso: string, year = true): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`
}

/** "1 May → 12 Jun 2025" — the year once, when both ends share it. */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '—'
  const sameYear = Boolean(end) && start.slice(0, 4) === end!.slice(0, 4)
  return `${formatDay(start, !sameYear)} → ${end ? formatDay(end, true) : '…'}`
}
