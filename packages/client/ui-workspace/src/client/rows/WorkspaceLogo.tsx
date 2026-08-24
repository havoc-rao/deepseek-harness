/**
 * One workspace logo image for the workspace browser tree's leading row slot:
 * a rounded, solid-backed 16px square. Once the image paints, it replaces the
 * standing folder glyph (its sibling): the chip background occludes the glyph
 * even for transparent images, while the folder remains the fallback while the
 * image is missing, loading, or failed. The row's hover folder->chevron swap
 * still applies, because the wrapper span keeps its .folder class.
 */
import { useState } from 'react'
import clsx from 'clsx'
import css from './Rows.module.css'

/**
 * Render the workspace logo image.
 * @param props.src - logo image source (URL or data URI).
 * @param props.className - extra class for layout placement.
 * @returns the image, or nothing once it fails to load (the folder glyph remains the fallback).
 */
export function WorkspaceLogo({ src, className }: {
  src: string
  className?: string | undefined
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className={clsx(css.workspaceLogo, className)}
      src={src}
      // Decorative: the adjacent row title carries the accessible name.
      alt=""
      loading="lazy"
      // The workspace row itself is draggable; a draggable logo would hijack its native drag.
      draggable={false}
      onError={() => { setFailed(true) }}
    />
  )
}
