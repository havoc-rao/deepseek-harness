// @vitest-environment jsdom
/**
 * Desktop-shell detection: UA parsing covers every shell variant and the
 * plain-browser no-op; markShellChrome writes the <html> dataset (the
 * contract the drag-strip and traffic-light CSS key off).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { detectShellChrome, markShellChrome } from '../src/shell-chrome.ts'

afterEach(() => {
  delete document.documentElement.dataset.shell
})

describe('detectShellChrome', () => {
  it('returns electron-mac for an Electron UA on macOS', () => {
    expect(detectShellChrome('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) dsh/0.0.0 Chrome/140.0.0.0 Electron/43.4.0 Safari/537.36'))
      .toBe('electron-mac')
  })

  it('returns electron-win for an Electron UA on Windows', () => {
    expect(detectShellChrome('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) dsh/0.0.0 Chrome/140.0.0.0 Electron/43.4.0 Safari/537.36'))
      .toBe('electron-win')
  })

  it('returns electron-linux for an Electron UA elsewhere', () => {
    expect(detectShellChrome('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) dsh/0.0.0 Chrome/140.0.0.0 Electron/43.4.0 Safari/537.36'))
      .toBe('electron-linux')
  })

  it('returns undefined for a plain browser UA', () => {
    expect(detectShellChrome('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'))
      .toBeUndefined()
  })
})

describe('markShellChrome', () => {
  it('marks <html data-shell> for a desktop shell', () => {
    markShellChrome('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) dsh/0.0.0 Chrome/140.0.0.0 Electron/43.4.0 Safari/537.36')
    expect(document.documentElement.dataset.shell).toBe('electron-mac')
  })

  it('leaves <html> unmarked in a plain browser', () => {
    markShellChrome('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
    expect(document.documentElement.dataset.shell).toBeUndefined()
  })

  it('defaults to navigator.userAgent and no-ops in a plain browser', () => {
    markShellChrome()
    expect(document.documentElement.dataset.shell).toBeUndefined()
  })
})
