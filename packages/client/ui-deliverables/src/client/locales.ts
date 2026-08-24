/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.showInFolder': '在文件夹中显示',
  'produced.totals': '累计修改 {files} 个文件 · +{added} -{removed} 行',
  'read.label': '读取',
  'read.moreOne': '+ 1 个文件',
  'read.more': '+ {count} 个文件',
  'read.open': '打开 {name}',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
  'produced.totals': 'Total: {files} files · +{added} -{removed} lines',
  'read.label': 'Read',
  'read.moreOne': '+ 1 file',
  'read.more': '+ {count} files',
  'read.open': 'Open {name}',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
