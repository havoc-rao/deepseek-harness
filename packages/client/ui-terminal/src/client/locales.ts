/** `terminal` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '终端',
  'action.close': '关闭终端',
  'status.connecting': '正在连接…',
  'status.reconnecting': '连接断开，正在重连…',
  'status.exited': '进程已退出（代码 {code}）',
  'status.error': '会话建立失败',
} satisfies Record<string, string>

/** The terminal namespace key union. */
export type TerminalKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Terminal',
  'action.close': 'Close terminal',
  'status.connecting': 'Connecting…',
  'status.reconnecting': 'Disconnected, reconnecting…',
  'status.exited': 'Process exited (code {code})',
  'status.error': 'Failed to start session',
} satisfies Record<TerminalKey, string>
