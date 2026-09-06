/** Usage settings section: the whole-deployment token dashboard. */

import { useCallback, useEffect, useState } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageLedgerSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { UsageDashboardView, UsageSeriesPoint, UsageSeriesView, SeriesRange } from './shaping.ts'
import { SERIES_RANGES, shapeDashboard } from './shaping.ts'
import type { UsageLocaleKey } from './locales.ts'
import css from './UsageSection.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This feature's settings-section copy (the usage dashboard). */
    usage: UsageLocaleKey
  }
}

/** One usage fetch outcome the section's inject face resolves. */
export type UsageLoad =
  | { readonly ok: true; readonly snapshot: UsageLedgerSnapshot }
  | { readonly ok: false; readonly code: string; readonly detail: string }

/** Registration-side business face for the section. */
export interface UsageSectionInjected {
  /** Fetch one fresh totals snapshot; never rejects. */
  load: () => Promise<UsageLoad>
}

/** Props the renderer binds for the section. */
export type UsageSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'usage'>
  & InjectFace<UsageSectionInjected>

/** The localized label key of each selectable range. */
const RANGE_LABEL_KEY: Record<SeriesRange, UsageLocaleKey> = {
  '24h': 'range24h',
  '7d': 'range7d',
  '30d': 'range30d',
}

/** Shape state of the async dashboard load. */
type LoadState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'failed'; readonly code: string; readonly detail: string }
  | { readonly phase: 'ready'; readonly snapshot: UsageLedgerSnapshot }

/** Render one Usage page: totals grid, today, usage-over-time chart, routes, and sessions. */
export function UsageSection({ t, load }: UsageSectionProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  // The chart range is a viewing choice: it re-shapes the held snapshot and never refetches.
  const [range, setRange] = useState<SeriesRange>('24h')

  const refresh = useCallback(() => {
    setState({ phase: 'loading' })
    void load().then((outcome) => {
      if (outcome.ok) setState({ phase: 'ready', snapshot: outcome.snapshot })
      else setState({ phase: 'failed', code: outcome.code, detail: outcome.detail })
    })
  }, [load])

  useEffect(() => {
    refresh()
  }, [refresh])

  const view = state.phase === 'ready'
    ? shapeDashboard(state.snapshot, {
      requests: t('requestsLabel'),
      input: t('inputLabel'),
      cacheRead: t('cacheReadLabel'),
      cacheWrite: t('cacheWriteLabel'),
      output: t('outputLabel'),
      total: t('totalLabel'),
    }, range)
    : undefined

  return (
    <div className={css.section}>
      <div className={css.headerRow}>
        <h2 className={css.heading}>{t('title')}</h2>
        <button type='button' className={css.refresh} onClick={refresh}>{t('refresh')}</button>
      </div>
      <p className={css.intro}>{t('intro')}</p>
      {state.phase === 'loading' && <p className={css.muted}>{t('loading')}</p>}
      {state.phase === 'failed' && (
        <p className={css.error}>
          {t('loadFailed')}
          {' '}
          <span className={css.code}>{state.code}</span>
          <span className={css.code}>{state.detail}</span>
        </p>
      )}
      {state.phase === 'ready' && view !== undefined && <Dashboard t={t} view={view} range={range} onRange={setRange} />}
    </div>
  )
}

/** Dashboard body once a snapshot is ready. */
function Dashboard({ t, view, range, onRange }: {
  t: (key: UsageLocaleKey) => string
  view: UsageDashboardView
  range: SeriesRange
  onRange: (range: SeriesRange) => void
}) {
  return (
    <>
      <section className={css.card} aria-label={t('totalsHeading')}>
        <h3 className={css.cardHeading}>{t('totalsHeading')}</h3>
        <div className={css.figures}>
          {view.figures.map(figure => (
            <div key={figure.id} className={css.figure} data-figure={figure.id} title={figure.exact}>
              <span className={css.figureHead}>
                <span className={css.figureDot} data-figure={figure.id} />
                <span className={css.figureLabel}>{figure.label}</span>
              </span>
              <span className={css.figureValue}>{figure.value}</span>
            </div>
          ))}
        </div>
        {view.composition.length > 0 && (
          <div className={css.composition} role='img' aria-label={t('totalsHeading')}>
            {view.composition.map(segment => (
              <span
                key={segment.id}
                className={css.compositionSegment}
                data-figure={segment.id}
                style={{ width: String(segment.percent) + '%' }}
                title={segment.label + ' · ' + segment.exact + ' · ' + String(segment.percent) + '%'}
              />
            ))}
          </div>
        )}
        <p className={css.ledgerPath}>
          {t('ledgerPathLabel')}
          {': '}
          {view.ledgerPath}
        </p>
      </section>
      <section className={css.card} aria-label={t('todayHeading')}>
        <h3 className={css.cardHeading}>{t('todayHeading')}</h3>
        {view.today === undefined
          ? <p className={css.muted}>{t('todayNone')}</p>
          : (
            <p className={css.todayLine} title={view.today.exact}>
              <strong className={css.todayTotal}>{view.today.total}</strong>
              {' · '}
              {view.today.requests}
            </p>
          )}
      </section>
      <section className={css.card}>
        <div className={css.cardHead}>
          <h3 className={css.cardHeading}>{t('trendHeading')}</h3>
          <div className={css.rangeRow}>
            {SERIES_RANGES.map(option => (
              <button
                key={option}
                type='button'
                className={css.rangeButton}
                data-active={range === option ? 'true' : undefined}
                onClick={() => { onRange(option) }}
              >
                {t(RANGE_LABEL_KEY[option])}
              </button>
            ))}
          </div>
        </div>
        {view.series.points.every(point => !point.active)
          ? <p className={css.muted}>{view.hasUsage ? t('trendEmptyRange') : t('trendEmpty')}</p>
          : <TimeChart series={view.series} label={t('trendHeading')} />}
      </section>
      <section className={css.card}>
        <h3 className={css.cardHeading}>{t('routesHeading')}</h3>
        {view.routes.length === 0
          ? <p className={css.muted}>{t('routesEmpty')}</p>
          : (
            <table className={css.table}>
              <thead>
                <tr>
                  <th scope='col'>{t('routeNameColumn')}</th>
                  <th scope='col'>{t('routeRequestsColumn')}</th>
                  <th scope='col'>{t('routeTokensColumn')}</th>
                  <th scope='col' className={css.shareColumn}>
                    <span className={css.visuallyHidden}>{t('routeShareColumn')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.routes.map(row => (
                  <tr
                    key={row.route}
                    title={row.tokens + ' · ' + t('shareOfTotalTitle').replace('{percent}', String(row.shareOfTotal))}
                  >
                    <td>{row.route}</td>
                    <td>{row.requests}</td>
                    <td>{row.tokens}</td>
                    <td className={css.shareCell}>
                      <span className={css.shareTrack}>
                        <span className={css.shareBar} style={{ width: String(row.share) + '%' }} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        {view.hiddenRoutes > 0 && <p className={css.more}>{t('moreRoutes').replace('{count}', String(view.hiddenRoutes))}</p>}
      </section>
      <section className={css.card} aria-label={t('sessionsHeading')}>
        <h3 className={css.cardHeading}>{t('sessionsHeading')}</h3>
        {view.sessions.length === 0
          ? <p className={css.muted}>{t('sessionsEmpty')}</p>
          : (
            <table className={css.table}>
              <thead>
                <tr>
                  <th scope='col'>{t('sessionColumn')}</th>
                  <th scope='col'>{t('sessionRequestsColumn')}</th>
                  <th scope='col'>{t('sessionTokensColumn')}</th>
                  <th scope='col' className={css.shareColumn}>
                    <span className={css.visuallyHidden}>{t('sessionShareColumn')}</span>
                  </th>
                  <th scope='col'>{t('sessionActivityColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {view.sessions.map(row => (
                  <tr
                    key={row.sessionId}
                    title={row.sessionId + ' · ' + row.exact + ' · ' + t('shareOfTotalTitle').replace('{percent}', String(row.shareOfTotal))}
                  >
                    <td>{row.label}</td>
                    <td>{row.requests}</td>
                    <td>{row.tokens}</td>
                    <td className={css.shareCell}>
                      <span className={css.shareTrack}>
                        <span className={css.shareBar} style={{ width: String(row.share) + '%' }} />
                      </span>
                    </td>
                    <td className={css.sessionActivity}>{row.lastActivity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        {view.hiddenSessions > 0 && <p className={css.more}>{t('moreSessions').replace('{count}', String(view.hiddenSessions))}</p>}
      </section>
    </>
  )
}

/** The chart's viewBox height; points keep a 2-unit inset top and bottom. */
const CHART_HEIGHT = 40

/** Map a 0-100 relative height onto the stretched viewBox. */
function toSvgY(y: number): number {
  return CHART_HEIGHT - 2 - (y / 100) * (CHART_HEIGHT - 4)
}

/**
 * The SVG time chart: an area over evenly spaced UTC buckets with per-bucket
 * hover titles, a half-peak gridline for reading intermediate values, and an
 * HTML peak marker (an SVG circle would stretch into an ellipse under the
 * non-uniform viewBox scaling).
 */
function TimeChart({ series, label }: { series: UsageSeriesView; label: string }) {
  const hitWidth = 100 / series.points.length
  const line = series.points.map(point => String(point.x) + ',' + String(toSvgY(point.y))).join(' ')
  const peak = series.points.reduce<UsageSeriesPoint | undefined>(
    (best, point) => (best === undefined || point.y > best.y ? point : best),
    undefined,
  )
  return (
    <div className={css.trendChartWrap}>
      <span className={css.trendPeak}>{series.peak}</span>
      <div className={css.trendPlot}>
        <svg
          className={css.trendChart}
          viewBox={'0 0 100 ' + String(CHART_HEIGHT)}
          preserveAspectRatio='none'
          role='img'
          aria-label={label}
        >
          <defs>
            <linearGradient id='dsh-usage-area' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' className={css.trendAreaStopTop} />
              <stop offset='100%' className={css.trendAreaStopBottom} />
            </linearGradient>
          </defs>
          <polygon className={css.trendArea} points={'0,' + String(CHART_HEIGHT) + ' ' + line + ' 100,' + String(CHART_HEIGHT)} />
          <line className={css.trendGridline} x1={0} x2={100} y1={toSvgY(50)} y2={toSvgY(50)} />
          <polyline className={css.trendLine} points={line} />
          {series.points.map(point => (
            <rect
              key={point.key}
              className={css.trendHit}
              x={Math.max(0, point.x - hitWidth / 2)}
              y={0}
              width={hitWidth}
              height={CHART_HEIGHT}
            >
              <title>{point.title}</title>
            </rect>
          ))}
        </svg>
        {peak !== undefined && peak.active && (
          <span
            className={css.trendPeakDot}
            style={{ left: String(peak.x) + '%', top: String((toSvgY(peak.y) / CHART_HEIGHT) * 100) + '%' }}
            title={peak.title}
          />
        )}
        <span className={css.trendHalf}>{series.half}</span>
      </div>
      <div className={css.trendAxis}>
        {series.axis.map((axis, index) => (
          <span
            key={axis.x}
            className={css.trendAxisLabel}
            style={{
              left: String(axis.x) + '%',
              transform: index === 0
                ? 'translateX(0)'
                : index === series.axis.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {axis.label}
          </span>
        ))}
      </div>
    </div>
  )
}
