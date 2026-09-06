// @vitest-environment jsdom
/**
 * Usage settings section, browser behavior: realistic fetch stubs drive the
 * rendered dashboard, and the spec asserts user-visible output.
 */

import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageSection } from '../src/client/usage-section.tsx'
import type { UsageLoad } from '../src/client/usage-section.tsx'
import type { UsageLedgerSnapshot, UsageLedgerTotals } from '@deepseek-ai/dsh-api-remotes/client'

/** A ready snapshot fixture. */
function snapshotOf(totalsOverrides: Partial<UsageLedgerTotals>): UsageLedgerSnapshot {
  const totals: UsageLedgerTotals = {
    requests: 2,
    inputTokens: 1500,
    outputTokens: 250000,
    cacheReadTokens: 987,
    cacheWriteTokens: 0,
    totalTokens: 252500,
    byModel: [
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', requests: 120, inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 0, totalTokens: 2_200_000 },
      { provider: 'pi', model: 'gateway', requests: 8, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 60_000 },
    ],
    byDay: [{ day: '2026-09-03', requests: 12, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 210_000 }],
    byHour: [{
      hour: new Date().toISOString().slice(0, 13), requests: 3, inputTokens: 0,
      outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 5_000,
    }],
    bySession: [
      { sessionId: 'session-63e82d3e-e4e9-49d7-8444-22bd34df0460', requests: 120, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 200_000, lastActivity: Date.UTC(2026, 8, 3) },
    ],
    lastRecordTime: 1000,
    ...totalsOverrides,
  }
  return { totals, ledgerDisplay: '~/.dsh/usage/usage.jsonl' }
}

/** Renderer props for one load stub. */
function propsFor(load: () => Promise<UsageLoad>) {
  return { t: stubT, load, close: () => {} } as unknown as Parameters<typeof UsageSection>[0]
}

/** The dictionary the stub t resolves. */
const copy: Record<string, string> = {
  nav: 'Usage',
  title: 'Token usage',
  intro: 'Whole-deployment token accounting.',
  refresh: 'Refresh',
  empty: 'No token usage recorded yet.',
  loading: 'Loading…',
  trendEmptyRange: 'No usage in this range — try another range.',
  shareOfTotalTitle: 'Share of all usage: {percent}%',
  loadFailed: 'Usage data is unavailable',
  retry: 'Retry',
  totalsHeading: 'All time',
  requestsLabel: 'Requests',
  inputLabel: 'Input',
  cacheReadLabel: 'Cache read',
  cacheWriteLabel: 'Cache write',
  outputLabel: 'Output',
  totalLabel: 'Total',
  todayHeading: 'Today (UTC)',
  todayNone: 'No usage today yet.',
  trendHeading: 'Usage over time (UTC)',
  range24h: '24 hours',
  range7d: '7 days',
  range30d: '30 days',
  trendEmpty: 'Not enough history for a trend yet.',
  routesHeading: 'By model',
  routesEmpty: 'No routes recorded.',
  routeNameColumn: 'Route',
  routeRequestsColumn: 'Requests',
  routeTokensColumn: 'Total tokens',
  ledgerPathLabel: 'Ledger file',
  moreRoutes: '{count} more routes',
  sessionsHeading: 'By session',
  sessionsEmpty: 'No sessions recorded.',
  sessionColumn: 'Session',
  sessionRequestsColumn: 'Requests',
  sessionTokensColumn: 'Total tokens',
  sessionActivityColumn: 'Last activity',
  moreSessions: '{count} more sessions',
}

/** The stub translate the spec renders with. */
function stubT(key: string): string {
  return copy[key] ?? key
}

describe('usage section', () => {
  afterEach(cleanup)

  it('renders the totals grid, today, trend, and routes when data loads', async () => {
    const screen = render(<UsageSection {...propsFor(async () => ({ ok: true, snapshot: snapshotOf({ totalTokens: 1_234_567 }) }))} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Token usage')).toBeDefined()
    expect(screen.getByText('1.2M')).toBeDefined()
    expect(screen.getByText('deepseek-official/deepseek-v4-flash')).toBeDefined()
    expect(screen.getByText((_, element) => element?.textContent === 'Ledger file: ~/.dsh/usage/usage.jsonl')).toBeDefined()
    expect(screen.getByText('63e82d3e…')).toBeDefined()
    expect(screen.getByText('2026-09-03')).toBeDefined()
    expect(screen.getByText('24 hours')).toBeDefined()
    expect(screen.getByText('7 days')).toBeDefined()
    expect(screen.getByText('30 days')).toBeDefined()
  })

  it('shows the failure copy with the wire code when the call fails', async () => {
    const screen = render(<UsageSection {...propsFor(async () => ({ ok: false, code: 'gateway/internal', detail: 'client api: usage/totals failed: HTTP 404' }))} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Usage data is unavailable')).toBeDefined()
    expect(screen.getByText('gateway/internal')).toBeDefined()
    expect(screen.getByText('client api: usage/totals failed: HTTP 404')).toBeDefined()
  })

  it('refetches on the refresh affordance', async () => {
    let loads = 0
    const screen = render(<UsageSection {...propsFor(async () => {
      loads += 1
      return { ok: true as const, snapshot: snapshotOf({}) }
    })} />)
    await act(async () => { await Promise.resolve() })
    expect(loads).toBe(1)
    await act(async () => { screen.getByText('Refresh').click() })
    expect(loads).toBe(2)
  })

  it('keeps the loading copy while the first fetch is in flight', async () => {
    let resolveLoad: ((outcome: UsageLoad) => void) | undefined
    const screen = render(<UsageSection {...propsFor(() => new Promise<UsageLoad>((resolve) => { resolveLoad = resolve }))} />)
    expect(screen.getByText('Loading…')).toBeDefined()
    await act(async () => {
      resolveLoad?.({ ok: true, snapshot: snapshotOf({}) })
      await Promise.resolve()
    })
    expect(screen.getByText('deepseek-official/deepseek-v4-flash')).toBeDefined()
  })

  it('shows an empty ledger without trend, routes, or sessions', async () => {
    const emptyTotals = {
      requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      totalTokens: 0, byModel: [], byDay: [], byHour: [], bySession: [],
    }
    const screen = render(<UsageSection {...propsFor(async () => ({ ok: true as const, snapshot: snapshotOf(emptyTotals) }))} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Not enough history for a trend yet.')).toBeDefined()
    expect(screen.getByText('No routes recorded.')).toBeDefined()
    expect(screen.getByText('No sessions recorded.')).toBeDefined()
  })

  it('summarizes sessions beyond the display cap', async () => {
    const bySession = Array.from({ length: 11 }, (_, index) => ({
      sessionId: 'session-' + String(index).padStart(8, '0'),
      requests: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 10, lastActivity: 0,
    }))
    const screen = render(<UsageSection {...propsFor(async () => ({ ok: true as const, snapshot: snapshotOf({ bySession }) }))} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('1 more sessions')).toBeDefined()
    expect(screen.getByText('00000009')).toBeDefined()
  })

  it('renders the hourly chart by default and switches ranges without refetching', async () => {
    const now = new Date()
    const byHour = [{
      hour: now.toISOString().slice(0, 13), requests: 3, inputTokens: 0,
      outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 5_000,
    }]
    let loads = 0
    const screen = render(<UsageSection {...propsFor(async () => {
      loads += 1
      return { ok: true as const, snapshot: snapshotOf({ byHour }) }
    })} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('img', { name: 'Usage over time (UTC)' })).toBeDefined()
    expect(screen.getByText(now.toISOString().slice(11, 13) + ':00')).toBeDefined()
    expect(screen.getByText('24 hours').getAttribute('data-active')).toBe('true')
    await act(async () => { screen.getByText('7 days').click() })
    expect(screen.getByRole('img', { name: 'Usage over time (UTC)' })).toBeDefined()
    expect(screen.getByText(now.toISOString().slice(5, 10))).toBeDefined()
    await act(async () => { screen.getByText('30 days').click() })
    expect(screen.getByText('30 days').getAttribute('data-active')).toBe('true')
    expect(loads).toBe(1)
  })
})
