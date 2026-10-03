---
kind: upgrade-guide
description: "工作区 Files 在 Desktop 和 Web 上不再设置默认快捷键。"
---

# 工作区 Files 默认快捷键

[English](guide.md) | 中文

## 变更

命令 `workspace.files` 原先在 Desktop 使用 Mod+P，在 macOS 和 Windows Web 使用 Mod+Alt+P；Linux Web 原本就没有绑定。此命令现在在所有平台上均无默认绑定。Mod 在 macOS 上为 Command，在 Windows 和 Linux 上为 Control。Files 开始页按钮、标签页和可自定义命令仍可使用，不设置替代快捷键。

## 迁移

1. 如果需要 Files 快捷键，请在快捷键设置中为 `workspace.files` 设置绑定。否则继续通过开始页按钮打开 Files。
2. 已有保存的覆盖项不会删除。如果曾为 Files 保存 Mod+P 或 Mod+Alt+P，且希望将该组合释放给其他命令，请在当前运行环境与平台配置中清除 Files 绑定，或恢复为现在无绑定的默认值。
3. 确认 Files 仍可从开始页按钮打开，且释放的组合不再打开 Files。在每个曾保存覆盖项的设备及运行环境与平台配置中重复修改；[快捷键偏好](../../../../packages/client/shortcuts/README.zh.md)保存在设备本地。
