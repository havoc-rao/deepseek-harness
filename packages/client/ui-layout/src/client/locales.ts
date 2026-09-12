/** `settings.layout` namespace dictionaries (the right-panel width row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rightPanelWidth.title': '右侧栏宽度',
  'rightPanelWidth.description': '右侧栏面板的宽度',
  'rightPanelWidth.unit': 'px',
  'rightPanelWidth.increase': '加宽右侧栏',
  'rightPanelWidth.decrease': '收窄右侧栏',
} satisfies Record<string, string>

/** The settings.layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'rightPanelWidth.title': 'Right panel width',
  'rightPanelWidth.description': 'Width of the right sidebar panel',
  'rightPanelWidth.unit': 'px',
  'rightPanelWidth.increase': 'Widen the right panel',
  'rightPanelWidth.decrease': 'Narrow the right panel',
} satisfies Record<LayoutKey, string>
