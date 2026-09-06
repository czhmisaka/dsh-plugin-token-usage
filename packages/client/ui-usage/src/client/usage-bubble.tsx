/**
 * Usage bubble: a root-scoped shell overlay showing the deployment's compact
 * total token count across every session. Draggable anywhere in the viewport
 * (position persisted in localStorage); click opens a small summary panel.
 * The fetch runs on mount, on expand, and on a slow timer (the ledger moves
 * on every model call - a live counter would re-render on unrelated traffic).
 *
 * @module @deepseek-ai/dsh-client-ui-usage/usage-bubble
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageLedgerSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { formatCompactCount } from './shaping.ts'
import type { UsageLoad } from './usage-section.tsx'
import css from './UsageBubble.module.css'

/** Registration-side business face (shared with the settings section). */
export interface UsageBubbleInjected {
  /** Fetch one fresh totals snapshot; never rejects. */
  load: () => Promise<UsageLoad>
}

/** Props the renderer binds for the bubble. */
export type UsageBubbleProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'usage'>
  & InjectFace<UsageBubbleInjected>

/** Auto-refresh cadence while the bubble is mounted. */
const REFRESH_INTERVAL_MS = 60_000

/** Pointer movement below this many pixels is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4

/** localStorage key of the dragged bubble position (viewport left/top). */
const POSITION_STORAGE_KEY = 'dsh-usage-bubble-pos'

/** Viewport padding that keeps the dragged bubble on screen. */
const BUBBLE_MARGIN_PX = 8

/** A viewport-anchored top-left position for the bubble. */
interface BubblePosition {
  readonly x: number
  readonly y: number
}

/** Shape state of the bubble's data. */
type BubbleState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'failed'; readonly code: string; readonly detail: string }
  | { readonly phase: 'ready'; readonly snapshot: UsageLedgerSnapshot }

/** Read the persisted position, clamped into the current viewport. */
function readStoredPosition(): BubblePosition | null {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<BubblePosition> | null
    if (typeof parsed?.x !== 'number' || typeof parsed.y !== 'number') return null
    return clampPosition(parsed.x, parsed.y)
  } catch {
    return null
  }
}

/** Persist the position; storage failures (privacy modes) keep it session-scoped. */
function storePosition(position: BubblePosition): void {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position))
  } catch {
    // Storage unavailable - the position stays session-scoped.
  }
}

/** Clamp a viewport position so the bubble never leaves the visible area. */
function clampPosition(x: number, y: number): BubblePosition {
  const maxX = Math.max(BUBBLE_MARGIN_PX, window.innerWidth - BUBBLE_MARGIN_PX)
  const maxY = Math.max(BUBBLE_MARGIN_PX, window.innerHeight - BUBBLE_MARGIN_PX)
  return { x: Math.min(Math.max(x, BUBBLE_MARGIN_PX), maxX), y: Math.min(Math.max(y, BUBBLE_MARGIN_PX), maxY) }
}

/** Render the usage bubble with its expandable summary panel. */
export function UsageBubble({ t, load }: UsageBubbleProps) {
  const [state, setState] = useState<BubbleState>({ phase: 'loading' })
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<BubblePosition | null>(() => readStoredPosition())
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; baseX: number; baseY: number; moved: boolean } | undefined>()
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelHeight, setPanelHeight] = useState(0)

  const refresh = useCallback(() => {
    void load().then((outcome) => {
      if (outcome.ok) setState({ phase: 'ready', snapshot: outcome.snapshot })
      else setState({ phase: 'failed', code: outcome.code, detail: outcome.detail })
    })
  }, [load, t])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [refresh])

  // Measure the open panel so it can be anchored above the dragged bubble.
  useLayoutEffect(() => {
    if (open && panelRef.current !== null) setPanelHeight(panelRef.current.offsetHeight)
  }, [open])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!event.isPrimary || event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const base = position ?? { x: rect.left, y: rect.top }
    dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, baseX: base.x, baseY: base.y, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const origin = dragOrigin.current
    if (origin === undefined) return
    const dx = event.clientX - origin.pointerX
    const dy = event.clientY - origin.pointerY
    if (!origin.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    origin.moved = true
    setOpen(false)
    setPosition(clampPosition(origin.baseX + dx, origin.baseY + dy))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const origin = dragOrigin.current
    dragOrigin.current = undefined
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (origin === undefined || !origin.moved) return
    // A drag ends here; persist the clamped position held in state.
    setPosition((current) => {
      if (current !== null) storePosition(current)
      return current
    })
  }

  const total = state.phase === 'ready'
    ? formatCompactCount(state.snapshot.totals.totalTokens)
    : null

  return (
    <div className={css.bubbleLayer}>
      {open && state.phase === 'ready' && (
        <div ref={panelRef} className={css.panel} role='dialog' aria-label={t('title')} style={panelStyle(position, panelHeight)}>
          <div className={css.panelHead}>
            <span className={css.panelTitle}>{t('title')}</span>
            <button type='button' className={css.close} onClick={() => setOpen(false)} aria-label={t('close')}>{t('closeMark')}</button>
          </div>
          <div className={css.panelRow}>
            <span className={css.panelLabel}>{t('totalLabel')}</span>
            <span className={css.panelValue}>{formatCompactCount(state.snapshot.totals.totalTokens)}</span>
          </div>
          <div className={css.panelRow}>
            <span className={css.panelLabel}>{t('requestsLabel')}</span>
            <span className={css.panelValue}>{formatCompactCount(state.snapshot.totals.requests)}</span>
          </div>
          <div className={css.panelRow}>
            <span className={css.panelLabel}>{t('todayHeading')}</span>
            <span className={css.panelValue}>{todayTokens(state.snapshot.totals.byDay)}</span>
          </div>
          <p className={css.panelHint}>{t('ledgerPathLabel')}: {state.snapshot.ledgerDisplay}</p>
        </div>
      )}
      <button
        type='button'
        className={css.bubble}
        data-failed={state.phase === 'failed' ? 'true' : undefined}
        style={bubbleStyle(position)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => { if (dragOrigin.current === undefined) { setOpen(previous => !previous); if (state.phase !== 'loading') refresh() } }}
        aria-label={t('bubbleAria')}
        title={t('bubbleAria')}
      >
        {total === null
          ? <span className={css.bubbleMark}>{t('bubbleMark')}</span>
          : (
            <span className={css.bubbleBody}>
              <span className={css.bubbleValue}>{total}</span>
              <span className={css.bubbleUnit}>{t('bubbleTotal')}</span>
            </span>
          )}
      </button>
    </div>
  )
}

/** Inline position styles once the bubble has been dragged; CSS defaults otherwise. */
function bubbleStyle(position: BubblePosition | null): Record<string, string> | undefined {
  if (position === null) return undefined
  return { left: String(Math.round(position.x)) + 'px', top: String(Math.round(position.y)) + 'px', right: 'auto', bottom: 'auto' }
}

/** Anchor the open panel above the bubble (below it when the top is too tight). */
function panelStyle(position: BubblePosition | null, panelHeight: number): Record<string, string> | undefined {
  if (position === null) return undefined
  const maxLeft = Math.max(BUBBLE_MARGIN_PX, window.innerWidth - 248)
  const left = Math.min(Math.max(position.x, BUBBLE_MARGIN_PX), maxLeft)
  const above = position.y - panelHeight - BUBBLE_MARGIN_PX
  const top = above >= BUBBLE_MARGIN_PX ? above : position.y + 40
  return { left: String(Math.round(left)) + 'px', top: String(Math.round(top)) + 'px', right: 'auto', bottom: 'auto' }
}

/** Today's (UTC) compact total from the newest day entry, or an em dash. */
function todayTokens(byDay: readonly { day: string; totalTokens: number }[]): string {
  const today = new Date().toISOString().slice(0, 10)
  const entry = [...byDay].reverse().find(row => row.day <= today)
  return entry === undefined ? '-' : formatCompactCount(entry.totalTokens)
}
