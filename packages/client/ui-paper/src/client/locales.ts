/** `settings.paper` namespace dictionaries (the paper-tone row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'paper.title': '纸面色调',
  'paper.default': '默认',
  'paper.cream': '米白',
  'paper.sepia': '羊皮纸',
  'paper.green': '护眼绿',
} satisfies Record<string, string>

/** The settings.paper namespace key union. */
export type PaperKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'paper.title': 'Paper tone',
  'paper.default': 'Default',
  'paper.cream': 'Cream',
  'paper.sepia': 'Sepia',
  'paper.green': 'Green',
} satisfies Record<PaperKey, string>
