import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TerminalView } from './TerminalView'
import css from './TerminalPane.module.css'

/** Terminal pane props: frame `shell.overlay` slot injection face plus the `terminal` dictionary. */
export type TerminalPaneProps = PropsRuntime<'shell.overlay'> & PropsLocale<'terminal'>

/**
 * Terminal pane contributed to the `shell.overlay` list slot. Closed by
 * default; the floating toggle opens it, the header close button (or Escape)
 * closes it. The pane body mounts a {@link TerminalView}; unmounting tears the
 * pty down, so opening and closing the pane spans a fresh session each time.
 * The shell spawns in the current session's workspace directory (its cwd),
 * falling back to the host process cwd when no session is selected.
 * @param props - slot injection face and translated copy.
 */
export function TerminalPane(props: TerminalPaneProps) {
  const [open, setOpen] = useState(false)
  const cwd = props.useSessions((sessions) => {
    const current = sessions.current
    if (current === undefined) return undefined
    const path = sessions.byId[current]?.cwd
    return path !== undefined && path !== '' ? path : undefined
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <>
      {!open && (
        <button type="button" className={css.toggle} onClick={() => { setOpen(true) }}>
          {props.t('title')}
        </button>
      )}
      {open && (
        <aside className={css.panel}>
          <header className={css.header}>
            <span className={css.status} aria-hidden="true" />
            <span className={css.title}>{props.t('title')}</span>
            <button type="button" className={css.close} aria-label={props.t('action.close')} onClick={() => { setOpen(false) }}>
              ×
            </button>
          </header>
          <div className={css.body}>
            <TerminalView t={props.t} cwd={cwd} />
          </div>
        </aside>
      )}
    </>
  )
}
