/** `approval` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  waiting: '等待审批',
  'detail.aria': '审批详情',
  escalation: '工具 {toolName} 请求越权执行',
  reject: '拒绝',
  allowOnce: '允许一次',
  copy: '复制',
  copied: '已复制',
  'codeBlock.title': '代码块',
  'codeBlock.wrap': '自动换行',
  'codeBlock.unwrap': '取消换行',
  'markdown.footnotes': '脚注',
} satisfies Record<string, string>

/** Approval dictionary key union. */
export type ApprovalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  waiting: 'Waiting for approval',
  'detail.aria': 'Approval details',
  escalation: 'Tool {toolName} requests privileged execution',
  reject: 'Reject',
  allowOnce: 'Allow once',
  copy: 'Copy',
  copied: 'Copied',
  'codeBlock.title': 'Code block',
  'codeBlock.wrap': 'Wrap lines',
  'codeBlock.unwrap': 'Unwrap lines',
  'markdown.footnotes': 'Footnotes',
} satisfies Record<ApprovalKey, string>
