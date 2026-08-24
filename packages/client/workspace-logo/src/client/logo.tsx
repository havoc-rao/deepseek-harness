/**
 * The workspace-logo surface's three row-hole occupants: the leading 16px
 * logo cell, the ellipsis-menu logo-add entry, and the hover-card header
 * logo. All data and callbacks arrive via the hole owner conversation plus
 * the plugin's inject face; the picker and its file validation live here
 * with the surface, not in the row core.
 */
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconCameraOutline16, IconFolderClose16, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceLogoInjected } from './index.ts'
import css from './logo.module.css'

/** Max bytes of an accepted workspace logo image (bounds the data URL the Host records). */
const LOGO_IMAGE_MAX_BYTES = 2 * 1024 * 1024

/** The standing folder glyph, keyed by the group's expansion state. */
function FolderGlyph({ expanded }: { expanded: boolean }) {
  return expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />
}

/**
 * One workspace logo image: a rounded cover-cropped chip that falls back to
 * the given glyph while absent, loading, or failed. Decorative: the adjacent
 * row title carries the accessible name.
 */
function WorkspaceLogoImage({ src, className, fallback }: {
  src: string
  className?: string | undefined
  fallback: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return <>{fallback}</>
  return (
    <img
      className={clsx(css.logo, className)}
      src={src}
      alt=""
      loading="lazy"
      // The workspace row itself is draggable; a draggable logo would hijack its native drag.
      draggable={false}
      onError={() => { setFailed(true) }}
    />
  )
}

/**
 * Leading 16px cell occupant: the host-persisted logo image, with the folder
 * glyph as the no-logo / loading / failure fallback (mirrors the row core's
 * standing cell).
 * @param props - the hole owner conversation.
 * @returns the cell content.
 */
export function WorkspaceLogoCell(props: PropsRuntime<'sidebar.workspaces.workspaceIcon'>) {
  const { expanded, logo } = props
  if (logo === undefined) return <FolderGlyph expanded={expanded} />
  return <WorkspaceLogoImage src={logo} fallback={<FolderGlyph expanded={expanded} />} />
}

/**
 * Ellipsis-menu footer occupant: the logo-add entry that opens the image
 * picker and commits the picked data URL through the plugin's inject face.
 * @param props - the hole owner conversation plus the plugin's business face.
 * @returns the picker input and the menu row.
 */
export function WorkspaceLogoMenuEntry(
  props: PropsRuntime<'sidebar.workspaces.workspaceMenu'> & WorkspaceLogoInjected,
) {
  const { workspaceId, pick, t } = props
  const inputRef = useRef<HTMLInputElement>(null)
  /** Validate the picked image file (type plus size bound) and report it as a data URL. */
  const readLogoImage = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.currentTarget.files?.[0]
    // Reset the input so picking the same file again re-fires change.
    e.currentTarget.value = ''
    if (file === undefined || !file.type.startsWith('image/') || file.size > LOGO_IMAGE_MAX_BYTES) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      /* v8 ignore next -- readAsDataURL always resolves to a string; the guard only satisfies the union type */
      if (typeof result !== 'string') return
      pick(workspaceId, result)
    }
    reader.readAsDataURL(file)
  }
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={readLogoImage}
      />
      <button
        type="button"
        className={css.menuRow}
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
      >
        <IconCameraOutline16 />
        <span>{t('menu.addLogo')}</span>
      </button>
    </>
  )
}

/**
 * Hover-card header occupant: the card-sized logo image; absent logo renders
 * nothing, leaving the owner's title-only heading.
 * @param props - the hole owner conversation.
 * @returns the card logo, or nothing.
 */
export function WorkspaceHoverLogo(props: PropsRuntime<'sidebar.workspaces.workspaceHoverIcon'>) {
  const { logo } = props
  if (logo === undefined) return null
  return <WorkspaceLogoImage src={logo} className={css.hoverLogo} fallback={null} />
}
