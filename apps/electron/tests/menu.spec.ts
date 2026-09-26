/**
 * Unit tests for the application menu template (apps/electron/src/menu.ts).
 * Pure template inspection without an Electron runtime: labels and
 * accelerators come from the roles at build time, so this suite pins the
 * parts the app decided — no role or accelerator may map to Cmd+W / Ctrl+W,
 * and the menus that must survive (App/Quit, Edit roles) stay present.
 */
import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { createApplicationMenuTemplate } from '../src/menu.ts'

/** The window-close accelerators the menu must never carry. */
const FORBIDDEN_ACCELERATORS = /^(commandorcontrol|cmdorctrl|command|cmd|control|ctrl|meta)\+w$/i

/** Every template item, submenus included. */
function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  const visit = (item: MenuItemConstructorOptions): void => {
    out.push(item)
    if (Array.isArray(item.submenu)) {
      for (const child of item.submenu) visit(child)
    }
  }
  for (const item of items) visit(item)
  return out
}

describe('createApplicationMenuTemplate', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('offers no close role or Cmd+W/Ctrl+W accelerator on %s', (platform) => {
    for (const item of flatten(createApplicationMenuTemplate(platform))) {
      expect(item.role).not.toBe('close')
      if (item.accelerator !== undefined) expect(item.accelerator).not.toMatch(FORBIDDEN_ACCELERATORS)
    }
  })

  it('keeps the macOS App menu first (About / Quit with Cmd+Q), then Edit / View / Window / Help', () => {
    expect(createApplicationMenuTemplate('darwin').map(entry => entry.role))
      .toEqual(['appMenu', 'editMenu', 'viewMenu', 'windowMenu', 'help'])
  })

  it('keeps File (Quit), Edit, View, and Window on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(createApplicationMenuTemplate(platform).map(entry => entry.role))
        .toEqual(['fileMenu', 'editMenu', 'viewMenu', 'windowMenu'])
    }
  })

  it('never places the Close-bearing fileMenu role on macOS', () => {
    const roles = flatten(createApplicationMenuTemplate('darwin')).map(item => item.role)
    expect(roles).not.toContain('fileMenu')
  })

  it('hardcodes no menu copy and no explicit accelerator — the roles localize them', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      for (const item of flatten(createApplicationMenuTemplate(platform))) {
        expect(item.label).toBeUndefined()
        expect(item.accelerator).toBeUndefined()
      }
    }
  })
})
