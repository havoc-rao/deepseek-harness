/** `settings.theme` namespace dictionaries (the Appearance row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.system': '跟随系统',
  'appearance.paper.title': '纸面色调',
  'appearance.paper.default': '默认',
  'appearance.paper.cream': '米白',
  'appearance.paper.sepia': '羊皮纸',
  'appearance.paper.green': '护眼绿',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.paper.title': 'Paper tone',
  'appearance.paper.default': 'Default',
  'appearance.paper.cream': 'Cream',
  'appearance.paper.sepia': 'Sepia',
  'appearance.paper.green': 'Green',
} satisfies Record<ThemeKey, string>
