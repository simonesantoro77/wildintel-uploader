/** The platforms a deployment can be uploaded to — Trapper, and Agouti (whose settings are kept, though nothing is uploaded to it yet). Each is set up in the Uploader section
 * of the settings, and each has its uploads in the Uploads dashboard: a new platform is one more line here. */
export const UPLOAD_DESTINATIONS = [{ id: 'trapper', label: 'TRAPPER' }, { id: 'agouti', label: 'Agouti' }] as const

export type UploadDestinationId = (typeof UPLOAD_DESTINATIONS)[number]['id']

/** What a platform is called: its label, or the id when it is one this version does not know. */
export const destinationLabel = (id: string): string => UPLOAD_DESTINATIONS.find((d) => d.id === id)?.label ?? id
