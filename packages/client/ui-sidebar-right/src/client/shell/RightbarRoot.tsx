/** Root-scoped controller for the right Sidebar's Session content. */
import { useLayoutEffect } from 'react'
import type { HostObservable, InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SidebarSessionViewSnapshot } from '../session-views.ts'
import type {} from '../contract/slots.ts'
import css from './SidebarRight.module.css'

/** Root-only retained Session targets and their committed mount lifetimes. */
export interface RightbarRootInjected {
  readonly hooks: {
    readonly views: HostObservable<readonly SidebarSessionViewSnapshot[]>
    readonly rootActive: HostObservable<string | undefined>
  }
  readonly mountView: (reference: SessionReference) => () => void
  readonly closeRoot: (key: string) => void
  readonly presentRoot: (canShow: boolean) => void
}

type RootProps = PropsRuntime<'rightbar'> & PropsRenderSlots<'rightbar.session' | 'rightbar.root'> & InjectFace<RightbarRootInjected>

function SessionView({ view, visible, SessionProvider, renderSlot, mountView, width, viewportWidth, canShow }:
  Pick<RootProps, 'SessionProvider' | 'renderSlot' | 'mountView' | 'width' | 'viewportWidth' | 'canShow'>
  & { readonly view: SidebarSessionViewSnapshot; readonly visible: boolean }) {
  useLayoutEffect(() => mountView(view.reference), [mountView, view.reference])
  const active = visible && view.selected
  return <div className={css.session} hidden={!active} data-sidebar-right-session={view.sessionId}>
    <SessionProvider session={view.reference}>
      {renderSlot('rightbar.session', { width, viewportWidth, canShow, active, retainTab: view.retainTab })}
    </SessionProvider>
  </div>
}

/**
 * Keep independent Session subtrees and hide those outside the selected Conversation.
 * @param props - frame geometry, view targets and the authorized Session renderer.
 * @returns the foreground and retained background Sidebars.
 */
export function RightbarRoot({ usePanelInfo, useViews, useRootActive, ...props }: RootProps) {
  const conversation = usePanelInfo(info => info.activePanelId === null)
  const rootActive = useRootActive(value => value)
  const views = useViews(value => value)
  useLayoutEffect(() => {
    if (rootActive !== undefined) props.presentRoot(props.canShow)
  }, [rootActive, props.canShow, props.presentRoot])
  return <>
    {views.map(view => <SessionView key={view.sessionId} {...props} view={view}
      visible={conversation && rootActive === undefined} />)}
    {rootActive !== undefined && <div className={css.rootPanel} data-sidebar-right-root={rootActive}
      style={{ width: props.canShow ? props.width : props.viewportWidth }}>
      {props.renderSlot('rightbar.root', {
        width: props.width, viewportWidth: props.viewportWidth, canShow: props.canShow,
        close: () => { props.closeRoot(rootActive) },
      }, { entryKey: rootActive })}
    </div>}
  </>
}
