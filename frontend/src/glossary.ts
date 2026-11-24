/** What each word of the app means, in plain words: the one place that says it, for the glossary of the menu and any "?" that comes to be beside a term. */
export interface GlossaryEntry { term: string; meaning: string }

/** The words of the work, in alphabetical order. */
export const TERMS: GlossaryEntry[] = [
  { term: 'Camera', meaning: 'A camera trap. It is set at a location and keeps its images on an SD card.' },
  { term: 'Collection', meaning: 'The deployments of one revision, kept together in a folder named after it, such as R0042.' },
  { term: 'Deployment', meaning: 'The time a camera stays at a location with an SD card: from the visit that put the card in to the visit that collected it, with the conditions in which the camera was installed and the images it took.' },
  { term: 'Location', meaning: 'A place where a camera is set, such as DONA_01. It is sometimes also called a site.' },
  { term: 'Research project', meaning: 'A camera-trap study, such as DONA. It has its own locations, cameras, SD cards, trappers, visits and collections.' },
  { term: 'Revision', meaning: 'One visit to every location of a research project, numbered R0001, R0002… The deployments whose SD cards were put in during a revision are its collection.' },
  { term: 'SD card', meaning: 'The card that holds the images of a camera. One visit puts it in the camera and a later one collects it.' },
  { term: 'Trapper', meaning: 'A person who goes to the field. A visit says who went.' },
  { term: 'Visit', meaning: 'One trip to a location to do something at its camera: install it, check it, take it away… It says who went, when and what was done.' },
]
