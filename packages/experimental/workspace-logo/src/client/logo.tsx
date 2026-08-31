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

/** Max bytes of an accepted source image (bounds the in-memory read; phone photos pass). */
const LOGO_IMAGE_MAX_BYTES = 20 * 1024 * 1024
/** Max edge of the downscaled logo in device pixels (16px row, 32px hover — 256 is ample). */
const LOGO_MAX_EDGE = 256
/** Wire/durable cap for the stored data URL, mirrored from dsh-host-apiproxy. */
const LOGO_IMAGE_DATA_URL_MAX_LENGTH = 2_800_000

/**
 * Downscale a data URL through a canvas to {@link LOGO_MAX_EDGE}, returning a
 * compact PNG data URL. Returns undefined when the platform has no canvas 2D
 * context (jsdom unit lane) or the image cannot be decoded — the caller then
 * falls back to the raw data URL within the wire cap.
 */
async function downscaleLogo(dataUrl: string): Promise<string | undefined> {
  /* v8 ignore start -- the scaling path is browser-only: jsdom has no canvas
     2D context and cannot decode images, so the unit lane only ever sees the
     undefined return below and the caller's raw-data-URL fallback. */
  const context = document.createElement('canvas').getContext('2d')
  if (context === null) return undefined
  const image = new Image()
  await new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); image.src = dataUrl })
  const edge = Math.max(image.naturalWidth, image.naturalHeight)
  const scale = Math.min(1, LOGO_MAX_EDGE / Math.max(1, edge))
  const canvas = context.canvas
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
  /* v8 ignore stop */
}

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
  /** Read and downscale the picked image, committing a compact data URL; rejections warn loudly. */
  const readLogoImage = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.currentTarget.files?.[0]
    // Reset the input so picking the same file again re-fires change.
    e.currentTarget.value = ''
    if (file === undefined) {
      console.warn('workspace logo: no file selected')
      return
    }
    if (!file.type.startsWith('image/')) {
      console.warn(`workspace logo: rejected non-image file "${file.name}" (${file.type || 'no MIME type'})`)
      return
    }
    if (file.size > LOGO_IMAGE_MAX_BYTES) {
      console.warn(`workspace logo: rejected "${file.name}" (${file.size} bytes > ${LOGO_IMAGE_MAX_BYTES} cap)`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      /* v8 ignore next -- readAsDataURL always resolves to a string; the guard only satisfies the union type */
      if (typeof result !== 'string') return
      void downscaleLogo(result).then((scaled) => {
        /* v8 ignore next -- scaled is always undefined in the jsdom lane (no canvas); browsers provide it */
        const dataUrl = scaled ?? result
        if (dataUrl.length > LOGO_IMAGE_DATA_URL_MAX_LENGTH) {
          console.warn('workspace logo: image too large to store (exceeds the data-URL cap); pick a smaller picture')
          return
        }
        pick(workspaceId, dataUrl)
      })
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
