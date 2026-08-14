# 模块 05 — 丝滑体验（resize / 滚动 / 背压）

**状态：✅ 已完成**（代码实现 + 单测 + 手动验证全部通过；coverage 门禁补全划入模块 07）

> 进度快照（2026-08-14）：三个实施步骤的代码均已落地，client（`ui-terminal`）+ host（`terminal-web`）共 20 个单测全绿。手动验证已执行完毕并发现/修复一个根因 bug（详见下）；coverage 100% 门禁补全（含 0% 入口文件测试）划入模块 07 范围，未完成。

## 目标

移植 tabby `xtermFrontend.ts` 的丝滑技巧，让终端滚动跟手、尺寸变化不闪、大输出不卡。

## 范围

- `src/client/useTerminalLayout.ts`：ResizeObserver + 32ms 节流 + FitAddon.fit + resize 帧。
- `TerminalView`：FitAddon 装配、pinnedToBottom 滚动状态。
- `useTerminalSocket`：FlowControl ack 背压水位。
- **不做**：WebGL 渲染（模块 06）。

## 关键实现要点

- **FitAddon + resize 节流**：
  - `new FitAddon()` + `term.loadAddon(fitAddon)`。
  - `ResizeObserver` 观察容器；尺寸变化 32ms 节流后 `fitAddon.fit()`，并把新 cols/rows 发 `resize` 帧（复用协议 `encodeResize`）。
  - 若 fit 算出维度无变化则不重复发帧。
- **pinnedToBottom 滚动状态**：
  - 维护 `pinnedToBottom` 布尔：初始化 true；用户上滚置 false；回底置 true。
  - **pin 状态不来自 `onScroll`**：xterm 的 `onScroll` 仅内容驱动（新行），用户 wheel 滚动不触发（xterm.js #3864/#3201）。改在 host 容器上挂 `wheel` capture 监听：`deltaY < 0` 立即置 false（写帧到达前不被拉回），随后 `requestAnimationFrame` 复查 `viewportY + rows >= length` 决定是否 re-pin（回底恢复跟随）。capture 阶段因为 xterm 在内部 viewport 元素上处理 wheel 可能 stopPropagation。
  - 判定公式用 `viewportY`（视口顶行，上滚时移动）而非 `baseY`（光标行，对运行中 shell 恒在底部，公式恒 true 导致上滚从未被识别——手动验证发现的根因 bug）。
  - monkey-patch `xtermCore.scrollToBottom`：输出贴底写入前若 pinned 则滚动到底；用户滚动期间不抢焦点。
  - 版本敏感：`scrollToBottom`/`_renderRows` 属 5.5.x 私有 API，升级走 patch 测试。
- **FlowControl ack 背压**：
  - client 累计未 ack 输出字节数 `unackedBytes`；host 端也有 `sentBytes/ackedBytes` 水位。
  - 未 ack 超过阈值（pause 512KB / resume 256KB）时暂停 `term.write`（缓冲队列），写完后/收到输入时发送 `ack` 帧（4×Uint32LE 已消费水位）恢复。
  - host 端 `paused` 时暂停读取 pty output 流，收到 ack 再续读——避免大输出在 WS/内存里积压。

## 实施步骤

- [x] `useTerminalLayout.ts`：ResizeObserver + 32ms 节流 + fit + resize 帧（含维度无变化跳过）。
- [x] TerminalView：FitAddon 装配 + pinnedToBottom 状态 + scrollToBottom patch（`_core.scrollToBottom` 以 `.call(core)` 保 this）。
- [x] useTerminalSocket：ack 水位 + 512KB/256KB 阈值暂停/恢复 + buffered write。
- [x] 手动验证滚动跟手与大输出行为（2026-08-14 通过）。

## 手动验证记录（2026-08-14）

浏览器（dsh web :3080）+ Playwright 原生 wheel 验证「上滚不被打断」，全链路通过：

1. **自动贴底**：`seq 1 3000` 输出后 `scrollTop == maxScroll`（44835/44835）。
2. **上滚不被打断**：wheel 上滚 10000px（scrollTop 44835→34835）后 `echo; seq 1 300` 新输出，scrollTop 保持 ~34830 而 maxScroll 增长到 49380 —— 视口停在原处不被拉回。
3. **回底恢复跟随**：下滚到底后新输出 `seq 1 200`，scrollTop 跟随 maxScroll（52410/52410）。
4. **大输出不卡**：`seq 1 100000` 完成后页面可交互，scrollback 封顶 5000 行（scrollHeight 稳定 ~75000px），内存不暴涨；满 scrollback 下上滚再输出，视口内容（seq 行号段）保持不跳变，未被拉回。
5. **resize 跟手**：容器 560→400px 后 xterm 行宽即时重排 540→384px，`tput cols` 49（pty 收到 resize 帧）；恢复 560px 后 `tput cols` 69。
6. console 0 error / 0 warning。

**验证中发现的根因 bug 与修复**：pinned 判定原用 `baseY`（光标行，对运行中 shell 恒在底部），`baseY + rows >= length` 恒 true → 上滚从未被识别。单测、xterm JSDoc、tabby 参考实现三处确认语义后改为 `viewportY + rows >= length`；随后实测确认 `onScroll` 不因用户 wheel 滚动触发（scrollCount=0），pin 状态改由容器 `wheel` capture 事件驱动（见「关键实现要点」）。修复后单测（terminal-view 4 个含 wheel 事件模拟）与上述手动验证全绿。

## 验收标准

- [x] 拖拽/缩放面板尺寸，终端内容即时重排，无闪烁。
- [x] 输出时自动贴底；用户上滚查看时不被打断；回到底部恢复跟随。
- [x] `seq 1 100000` 类大输出：页面不卡死，滚动流畅，内存不暴涨。
- [x] resize 帧频率受限（32ms 节流生效，避免高频 WS 消息）。

## 风险与注意

- **xterm 版本锁定**：`^5.5.0`，私有 API（`_core`/`_renderRows`/`scrollToBottom`）依赖该版本行为。
- **背压阈值两端一致**：client 阈值与 host `sentBytes/ackedBytes` 水位要匹配（**pause 512KB / resume 256KB**），改一侧要改另一侧并跑双端测试。模块 05 代码已按此实现：`useTerminalSocket.ts` 与 `terminal-socket.ts` 各含 `OUTPUT_PAUSE_WATERMARK = 512 * 1024` / `OUTPUT_RESUME_WATERMARK = 256 * 1024`。
