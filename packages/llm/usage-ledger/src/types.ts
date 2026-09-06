/**
 * Public vocabulary of the token usage ledger: one durable record per billed
 * model call and the aggregated totals the service reports. Types only; the
 * runtime encoders and folds live in their own modules.
 *
 * @module @deepseek-ai/dsh-usage-ledger/types
 */

/** Version literal stamped on every ledger record line; the fold skips others. */
export type LedgerRecordVersion = 1

/**
 * One billed model call, appended to the ledger file as one JSON line. The
 * token counts are the disjoint buckets of the step's token usage:
 * uncached input, cache reads, cache writes, and output (reasoning included).
 */
export interface UsageLedgerRecord {
  /** Format version; the fold skips records it cannot validate. */
  version: LedgerRecordVersion
  /** Append time of the usage-carrying assistant/message event, epoch ms. */
  time: number
  /** Id of the session that made the billed call. */
  sessionId: string
  /** Provider route the call ran on, from the assistant message's source. */
  provider: string
  /** Provider model id the call ran on. */
  model: string
  /** Uncached input tokens reported by the adapter. */
  inputTokens: number
  /** Output tokens reported by the adapter; reasoning included. */
  outputTokens: number
  /** Cache-read input tokens reported by the adapter; 0 when unreported. */
  cacheReadTokens: number
  /** Cache-write input tokens reported by the adapter; 0 when unreported. */
  cacheWriteTokens: number
}

/** One non-negative token accounting with its request count and billed total. */
export interface UsageLedgerBucket {
  /** Usage-reporting assistant messages folded into this bucket. */
  requests: number
  /** Uncached input tokens. */
  inputTokens: number
  /** Output tokens; reasoning included. */
  outputTokens: number
  /** Cache-read input tokens. */
  cacheReadTokens: number
  /** Cache-write input tokens. */
  cacheWriteTokens: number
  /** Billed total: the sum of the four disjoint token buckets. */
  totalTokens: number
}

/** All-time totals for one exact provider/model route. */
export interface UsageLedgerModelTotals extends UsageLedgerBucket {
  /** Provider route the calls ran on. */
  provider: string
  /** Provider model id the calls ran on. */
  model: string
}

/** All-time totals for one UTC calendar day. */
export interface UsageLedgerDayTotals extends UsageLedgerBucket {
  /** UTC calendar day (YYYY-MM-DD) the records' append times fall on. */
  day: string
}

/** Totals for one UTC hour inside the trailing window. */
export interface UsageLedgerHourTotals extends UsageLedgerBucket {
  /** UTC hour key (YYYY-MM-DDTHH) the records' append times fall in. */
  hour: string
}

/** All-time totals for one session id. */
export interface UsageLedgerSessionTotals extends UsageLedgerBucket {
  /** Id of the session that made the billed calls. */
  sessionId: string
  /** Append time of the session's newest record, epoch ms. */
  lastActivity: number
}

/** Aggregated whole-ledger token usage, as served by ctx.usageLedger. */
export interface UsageLedgerTotals {
  /** Usage-reporting assistant messages folded into these totals. */
  requests: number
  /** Uncached input tokens across every record. */
  inputTokens: number
  /** Output tokens across every record. */
  outputTokens: number
  /** Cache-read input tokens across every record. */
  cacheReadTokens: number
  /** Cache-write input tokens across every record. */
  cacheWriteTokens: number
  /** Billed total across every record: the sum of the four disjoint buckets. */
  totalTokens: number
  /** Per-route totals sorted by totalTokens descending, then route name ascending. */
  byModel: readonly UsageLedgerModelTotals[]
  /** Per-UTC-day totals sorted ascending by day. */
  byDay: readonly UsageLedgerDayTotals[]
  /** Per-UTC-hour totals for the trailing 48 hours, sorted ascending by hour. */
  byHour: readonly UsageLedgerHourTotals[]
  /** Per-session totals sorted by totalTokens descending, then sessionId ascending. */
  bySession: readonly UsageLedgerSessionTotals[]
  /** Append time of the newest record, epoch ms; null when the ledger is empty. */
  lastRecordTime: number | null
}

/** Client-facing usage snapshot: the folded totals plus the display ledger location. */
export interface UsageLedgerSnapshot {
  /** The whole-ledger totals. */
  totals: UsageLedgerTotals
  /** Symbolic user-facing ledger location (home-relative when inside the home). */
  ledgerDisplay: string
}
