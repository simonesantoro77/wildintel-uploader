/** Where the visits of a research project can be taken from, besides being entered by hand: the CSV of the WildINTEL Epicollect project, Epicollect itself (its entries, with a mapping) and a CSV of any shape (its columns said when it is read). Each is set up in the Visit
 * sources section of the settings, and can be used or not: a new source is one more line here. */
export const VISIT_SOURCES = [{ id: 'wildintel-new', label: 'WildINTEL Epicollect CSV' }, { id: 'csv', label: 'Custom CSV' }, { id: 'epicollect', label: 'Epicollect5 connection' }] as const

export type VisitSourceId = (typeof VISIT_SOURCES)[number]['id']
