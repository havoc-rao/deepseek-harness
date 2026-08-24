/**
 * `workspace-logo` namespace dictionaries: the logo surface's own copy.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu.addLogo': '添加 logo 图片',
} as const

/** English dictionary mirroring {@link zh}. */
export const en = {
  'menu.addLogo': 'Add logo image',
} as const

/** The logo surface's locale keys. */
export type WorkspaceLogoKey = keyof typeof zh
