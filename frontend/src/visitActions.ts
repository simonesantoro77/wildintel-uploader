/** What a visit did, as the interface says it: the actions are kept by their names (`SiteStart`), and told as words. */
const LABELS: Record<string, string> = { SiteStart: 'Location start' }

export const actionLabel = (action: string): string => LABELS[action] ?? action
export const actionsLabel = (actions: readonly string[], separator = ' + '): string => actions.map(actionLabel).join(separator)

/** The revision a session names — "R0020" is 20 — or null when it names none. */
export const revisionNumber = (session: string | null | undefined): number | null => {
  const found = /\d+/.exec(session ?? '')
  return found ? Number(found[0]) : null
}
