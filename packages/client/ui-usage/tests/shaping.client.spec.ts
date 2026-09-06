/**
 * Unit behavior of the usage dashboard shaping: compact numbers, today
 * selection, the calendar-aligned time series, and route capping.
 */

import type { UsageLedgerSnapshot, UsageLedgerTotals } from '@deepseek-ai/dsh-api-remotes/client'
import { describe, expect, it } from 'vitest'
import type { SeriesRange } from '../src/client/shaping.ts'
import { formatCompactCount, shapeDashboard } from '../src/client/shaping.ts'

/** Localized figure labels the fold renders. */
const labels: Record<UsageFigureId, string> = {
  requests: 'Requests',
  input: 'Input',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  output: 'Output',
  total: 'Total',
}

/** Figure key union for the label map. */
type UsageFigureId = 'requests' | 'input' | 'cacheRead' | 'cacheWrite' | 'output' | 'total'

/** The UTC calendar day key of "now". */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/** One model-route row with unit counts. */
function routeRow(index: number) {
  return { provider: 'p' + String(index), model: 'm', requests: 1, inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1 }
}

/** One recorded day with a zeroed bucket set and the given total. */
function day(key: string, totalTokens: number) {
  return {
    day: key, requests: Math.min(3, totalTokens), inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens,
  }
}

/** One per-session totals row with unit counts and a fixed activity day. */
function sessionRow(index: number) {
  return {
    sessionId: 'session-' + String(index).padStart(8, '0') + '-0000',
    requests: 1, inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1,
    lastActivity: Date.UTC(2026, 8, 1),
  }
}

/** The base totals snapshot. */
function baseTotals(): UsageLedgerTotals {
  return {
    requests: 2,
    inputTokens: 1500,
    outputTokens: 250000,
    cacheReadTokens: 987,
    cacheWriteTokens: 0,
    totalTokens: 251500,
    byModel: [routeRow(0)],
    byDay: [day('2026-09-01', 1000)],
    byHour: [hourRow('2026-09-01T10', 1000)],
    bySession: [sessionRow(0)],
    lastRecordTime: 1000,
  }
}

/** A wire snapshot over one totals override. */
function snapshotOf(overrides: Partial<UsageLedgerTotals>): UsageLedgerSnapshot {
  return { totals: { ...baseTotals(), ...overrides }, ledgerDisplay: '~/.dsh/usage/usage.jsonl' }
}

/** Shaped view over one totals override at one chart range. */
function viewOf(overrides: Partial<UsageLedgerTotals>, range: SeriesRange = '7d') {
  return shapeDashboard(snapshotOf(overrides), labels, range)
}

/** The UTC calendar day key of "now" minus the given whole days. */
function dayKeyAt(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

/** The UTC hour key of "now" minus the given whole hours. */
function hourKeyAt(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString().slice(0, 13)
}

/** One recorded hour with a zeroed bucket set and the given total. */
function hourRow(key: string, totalTokens: number) {
  return {
    hour: key, requests: 1, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens,
  }
}

describe('formatCompactCount', () => {
  it('formats exact counts below one thousand and trims scaled zeros', () => {
    expect(formatCompactCount(0)).toBe('0')
    expect(formatCompactCount(999)).toBe('999')
    expect(formatCompactCount(1000)).toBe('1K')
    expect(formatCompactCount(1_234_567)).toBe('1.2M')
    expect(formatCompactCount(2_530_000_000)).toBe('2.53B')
    expect(formatCompactCount(1_250_100_000_000)).toBe('1.25T')
  })
})

describe('shapeDashboard', () => {
  it('shapes the six figures, routes, and ledger location', () => {
    const view = shapeDashboard(snapshotOf({}), labels, '7d')
    expect(view.figures.map(figure => figure.id)).toEqual([
      'requests', 'input', 'cacheRead', 'cacheWrite', 'output', 'total',
    ])
    expect(view.figures.find(figure => figure.id === 'input')?.value).toBe('1.5K')
    expect(view.routes[0]).toEqual({ route: 'p0/m', requests: '1', tokens: '1', share: 100, exact: '1', shareOfTotal: 0 })
    expect(view.ledgerPath).toBe('~/.dsh/usage/usage.jsonl')
  })

  it('omits the today card when no record falls on today', () => {
    expect(viewOf({}).today).toBeUndefined()
  })

  it('selects the today entry when one falls on the current day', () => {
    const view = viewOf({ byDay: [day(todayKey(), 500)] })
    expect(view.today).toEqual({ requests: '3', total: '500', exact: '500' })
  })

  it('returns an all-zero series before any recorded day', () => {
    const view = viewOf({ byDay: [], byHour: [], byModel: [], bySession: [] })
    expect(view.series.points).toHaveLength(7)
    expect(view.series.points.every(point => !point.active && point.y === 0)).toBe(true)
    expect(view.series.peak).toBe('0')
    expect(view.routes).toEqual([])
    expect(view.hiddenRoutes).toBe(0)
    expect(view.sessions).toEqual([])
  })

  it('shapes a calendar-aligned zero-filled series ending today', () => {
    const view = viewOf({ byDay: [day(dayKeyAt(0), 500), day('2026-08-20', 900)] })
    expect(view.series.points).toHaveLength(7)
    expect(view.series.points[6]).toMatchObject({ key: dayKeyAt(0), display: '500', active: true })
    // A recorded day outside the range drops out; recorded zero days read as zero.
    expect(view.series.points.some(point => point.key === '2026-08-20')).toBe(false)
    expect(view.series.points[0]).toMatchObject({ active: false, y: 0 })
  })

  it('extends the series to thirty points on the wider range', () => {
    const view = viewOf({ byDay: [day(dayKeyAt(0), 500)] }, '30d')
    expect(view.series.points).toHaveLength(30)
    expect(view.series.points[29]).toMatchObject({ key: dayKeyAt(0), active: true })
  })

  it('scales points against the peak day and labels the axis sparsely', () => {
    const view = viewOf({ byDay: [day(dayKeyAt(1), 500), day(dayKeyAt(0), 1000)] })
    expect(view.series.peak).toBe('1K')
    expect(view.series.points[5]).toMatchObject({ y: 50, active: true })
    expect(view.series.points[6]).toMatchObject({ y: 100, active: true, x: 100 })
    expect(view.series.axis[0]).toMatchObject({ label: dayKeyAt(6).slice(5), x: 0 })
    expect(view.series.axis[view.series.axis.length - 1]).toMatchObject({ label: dayKeyAt(0).slice(5), x: 100 })
    expect(view.series.axis.length).toBeLessThanOrEqual(5)
  })

  it('shapes an hourly zero-filled series ending the current hour', () => {
    const view = viewOf({ byHour: [hourRow(hourKeyAt(0), 500), hourRow('2020-01-01T00', 900)] }, '24h')
    expect(view.series.points).toHaveLength(24)
    expect(view.series.points[23]).toMatchObject({ key: hourKeyAt(0), display: '500', active: true, x: 100 })
    expect(view.series.points[23]?.label).toBe(hourKeyAt(0).slice(11) + ':00')
    expect(view.series.points.some(point => point.key === '2020-01-01T00')).toBe(false)
    expect(view.series.points[0]).toMatchObject({ active: false, y: 0 })
  })

  it('scales the hourly series against its peak hour', () => {
    const view = viewOf({ byHour: [hourRow(hourKeyAt(2), 500), hourRow(hourKeyAt(0), 1000)] }, '24h')
    expect(view.series.peak).toBe('1K')
    expect(view.series.points[21]).toMatchObject({ y: 50, active: true })
    expect(view.series.points[23]).toMatchObject({ y: 100, active: true })
    expect(view.series.points[10]?.title).toBe(hourKeyAt(13).slice(0, 10) + ' ' + hourKeyAt(13).slice(11) + ':00 · 0')
  })

  it('keeps at most eight route rows and summarizes the remainder', () => {
    const view = viewOf({ byModel: Array.from({ length: 10 }, (_, index) => routeRow(index)) })
    expect(view.routes).toHaveLength(8)
    expect(view.hiddenRoutes).toBe(2)
  })

  it('shapes session rows with compact labels, tokens, and activity days', () => {
    const view = viewOf({
      bySession: [
        { sessionId: 'session-63e82d3e-e4e9-49d7-8444-22bd34df0460', requests: 3, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 5000, lastActivity: Date.UTC(2026, 8, 5, 12) },
        { sessionId: 'short', requests: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 10, lastActivity: Date.UTC(2026, 8, 1) },
      ],
    })
    expect(view.sessions[0]).toEqual({
      sessionId: 'session-63e82d3e-e4e9-49d7-8444-22bd34df0460',
      label: '63e82d3e…',
      requests: '3',
      tokens: '5K',
      share: 100,
      exact: '5,000',
      shareOfTotal: 2,
      lastActivity: '2026-09-05',
    })
    expect(view.sessions[1]).toMatchObject({ label: 'short', share: Math.round((10 / 5000) * 100) })
  })

  it('keeps at most ten session rows and summarizes the remainder', () => {
    const view = viewOf({ bySession: Array.from({ length: 12 }, (_, index) => sessionRow(index)) })
    expect(view.sessions).toHaveLength(10)
    expect(view.hiddenSessions).toBe(2)
  })

  it('keeps zero recorded days out of the active set even inside the range', () => {
    const view = viewOf({ byDay: [day(dayKeyAt(2), 0)] })
    expect(view.series.points.every(point => !point.active)).toBe(true)
    expect(view.series.peak).toBe('0')
  })
})
