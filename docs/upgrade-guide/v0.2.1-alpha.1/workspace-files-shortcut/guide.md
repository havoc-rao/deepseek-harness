---
kind: upgrade-guide
description: "Workspace Files no longer assigns a default keyboard shortcut on Desktop or Web."
---

# Workspace Files default shortcut

English | [中文](guide.zh.md)

## Change

The `workspace.files` command previously used Mod+P on Desktop and Mod+Alt+P on macOS and Windows Web; Linux Web was already unbound. The command now has no default binding on any platform. Mod is Command on macOS and Control on Windows and Linux. The Files guide button, tab, and customizable command remain available. No replacement shortcut is assigned.

## Migration

1. If you want a Files shortcut, assign `workspace.files` in the shortcut settings. Otherwise, continue opening Files from its guide button.
2. Existing saved overrides are not deleted. If you previously saved Mod+P or Mod+Alt+P for Files and want to release that combination for another command, clear the Files binding or restore its now-unbound default in the current runtime/platform profile.
3. Confirm that Files still opens from its guide button and that the released combination no longer opens Files. Repeat the override change on each device and runtime/platform profile where you saved it; [shortcut preferences](../../../../packages/client/shortcuts/README.md) are device-local.
