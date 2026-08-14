# 模块 06 — 渲染器与主题（WebGL / GPU 恢复 / 防 flash）

**状态：✅ 已完成**（前置：05）

## 目标

WebGL 硬件加速渲染 + GPU context 丢失自动恢复，主题联动无闪烁，系统字体栈保证字体不闪。

## 范围

- TerminalView：WebglAddon 装配、GPU context 丢失处理、Canvas 回退。
- `terminal.module.css`：完整样式（系统等宽字体栈、细窄滚动条）。
- 主题联动：深色终端美学 + 页面主题切换时无闪烁。

## 关键实现要点

- **WebglAddon + GPU 恢复**：
  - `term.loadAddon(new WebglAddon())`；监听 `onContextLoss`，3 次预算内重建 addon（`dispose` 后重新 load），超预算回退 `CanvasAddon`。
  - `doResize` 后强制 `_renderRows()` 防闪（5.5.x 私有 API）。
  - WebglAddon 构造函数可带 `preserveDrawingBuffer` 选项（按需），注意显存/预算。
- **主题联动防 flash**：
  - 监听 `theme/change`（ui-theme 的 `ctx.theme.getTheme()`/`on('theme/change')`，参照 ui-layout 的 `ThemePresenter` 模式），把主题色映射到 `term.options.theme`。
  - 切换瞬间先写 DOM 主题变量再更新 xterm theme，避免先亮后暗的闪烁。
  - 面板底色与页面深色背景一致（#0D1117 系），圆角浮层 + 细工具条。
- **系统字体栈**（不 import 官方 woff2）：
  - `fontFamily: 'Menlo, Consolas, "Courier New", monospace'`，fontSize 13px，行高 1.0。
  - 若字形异常再调大 `assetInlineLimit` base64 inline 内置 woff2。
- **滚动条**：细窄、hover 显现，保持终端沉浸感。

## 实施步骤

- [x] WebglAddon 装配 + onContextLoss 恢复（3 次预算 → Canvas 回退）。
- [x] `doResize` 后 `_renderRows()` 防闪。
- [x] 主题联动：theme/change → `term.options.theme` 更新，切换无闪烁。
- [x] `terminal.module.css` 完整样式 + 系统字体栈 + 细窄滚动条。
- [x] 手动验证 WebGL 渲染、GPU 上下文异常恢复、主题切换。

## 验收标准

- [x] WebGL 渲染下大输出流畅无撕裂（对比 Canvas 明显省 CPU）。
- [x] GPU context 丢失后自动重建；预算耗尽回退 Canvas 仍可用。
- [x] 页面主题切换（深/浅）终端即时跟随，无白闪。
- [x] 字体渲染稳定，无 FOUT（字体未加载导致的闪烁）。

## 风险与注意

- **私有 API 依赖版本**：`_renderRows` 依赖 xterm 5.5.x；升级 xterm 必须回归本模块 + patch 测试。
- **GPU 预算**：WebGL 显存超限同样触发 context 丢失，恢复逻辑要能兜住反复丢失。
- **主题变量映射**：与 ui-theme 的调色板（primary/background/text/functional）对齐，避免硬编码色值漂移。
