/** What each word of the app means, in plain words: the one place that says it, for the glossary of the menu and any "?" that comes to be beside a term. */
export interface GlossaryEntry { term: string; meaning: string }

/** The words of the work, from the whole to its parts: the research project, what is in the field, the work done there and what it gives. */
export const TERMS: GlossaryEntry[] = [
  { term: 'Research project', meaning: 'A camera-trap study, such as DONA. Its locations, cameras, SD cards, trappers, visits and images all belong to it. Create it here, or link one that already exists in TRAPPER.' },
  { term: 'Location', meaning: 'A place where a camera is set, such as DONA_01. It is sometimes also called a site. It can come from TRAPPER or be created in WildINTEL Uploader.' },
  { term: 'Camera', meaning: 'A camera trap. It is set at a location and keeps its images on an SD card.' },
  { term: 'SD card', meaning: 'The card that holds the images of a camera. One visit puts it in the camera and a later one collects it.' },
  { term: 'Trapper', meaning: 'A person who goes to the field. A visit says who went.' },
  { term: 'Visit', meaning: 'One time someone goes to a location to do something at its camera: install it, check it, take it away… It says who went, when and what was done.' },
  { term: 'Revision', meaning: 'One visit to every location of a research project, numbered R0001, R0002… It is sometimes also called a field trip.' },
  { term: 'Deployment', meaning: 'The images of one camera at one location between two visits: from the visit that put an SD card in the camera to the visit that collected that card. It is what is uploaded to TRAPPER.' },
  { term: 'Collection', meaning: 'The deployments whose SD cards were put in during the same revision, kept and uploaded together, and named after it, such as R0042.' },
]
