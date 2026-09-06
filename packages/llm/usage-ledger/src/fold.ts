/**
 * Pure fold of validated ledger records into frozen whole-ledger totals.
 * Kept free of I/O so boot folds, incremental service reads, and tests share
 * one accounting implementation.
 *
 * @module @deepseek-ai/dsh-usage-ledger/fold
 */

import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { UsageLedgerDayTotals, UsageLedgerHourTotals, UsageLedgerModelTotals, UsageLedgerRecord, UsageLedgerSessionTotals, UsageLedgerTotals } from './types.ts'

/** Mutable accumulator behind one totals value; not part of the public surface. */
export interface UsageTotalsAccumulator {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  lastRecordTime: number | null
  byModel: Map<string, UsageLedgerModelTotals>
  byDay: Map<string, UsageLedgerDayTotals>
  byHour: Map<string, UsageLedgerHourTotals>
  bySession: Map<string, UsageLedgerSessionTotals>
}

/** Composite by-model map key; internal and never displayed. */
function modelKey(provider: string, model: string): string {
  return provider + '\u0000' + model
}

/** Bucket fields shared by the grand, per-model, and per-day totals. */
interface MutableBucket {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

/** Add one record's disjoint buckets into one bucket-shaped holder. */
function accumulateBucket(holder: MutableBucket, record: UsageLedgerRecord): void {
  holder.requests += 1
  holder.inputTokens += record.inputTokens
  holder.outputTokens += record.outputTokens
  holder.cacheReadTokens += record.cacheReadTokens
  holder.cacheWriteTokens += record.cacheWriteTokens
  holder.totalTokens = holder.inputTokens + holder.outputTokens + holder.cacheReadTokens + holder.cacheWriteTokens
}

/**
 * Start an empty fold.
 * @returns a fresh accumulator with zeroed totals.
 */
export function createAccumulator(): UsageTotalsAccumulator {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    lastRecordTime: null,
    byModel: new Map(),
    byDay: new Map(),
    byHour: new Map(),
    bySession: new Map(),
  }
}

/**
 * Fold one validated record into the accumulator in place. Records reach
 * here only through parseRecordLine, which rejects ill-typed counts.
 *
 * @param accumulator - fold state to update.
 * @param record - the record to fold.
 */
export function accumulateRecord(accumulator: UsageTotalsAccumulator, record: UsageLedgerRecord): void {
  accumulateBucket(accumulator, record)
  if (accumulator.lastRecordTime === null || record.time > accumulator.lastRecordTime) {
    accumulator.lastRecordTime = record.time
  }
  const modelKeyString = modelKey(record.provider, record.model)
  let modelTotals = accumulator.byModel.get(modelKeyString)
  if (modelTotals === undefined) {
    modelTotals = {
      provider: record.provider,
      model: record.model,
      requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
    }
    accumulator.byModel.set(modelKeyString, modelTotals)
  }
  accumulateBucket(modelTotals, record)
  const day = new Date(record.time).toISOString().slice(0, 10)
  let dayTotals = accumulator.byDay.get(day)
  if (dayTotals === undefined) {
    dayTotals = { day, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }
    accumulator.byDay.set(day, dayTotals)
  }
  accumulateBucket(dayTotals, record)
  const hour = new Date(record.time).toISOString().slice(0, 13)
  let hourTotals = accumulator.byHour.get(hour)
  if (hourTotals === undefined) {
    hourTotals = { hour, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }
    accumulator.byHour.set(hour, hourTotals)
  }
  accumulateBucket(hourTotals, record)
  let sessionTotals = accumulator.bySession.get(record.sessionId)
  if (sessionTotals === undefined) {
    sessionTotals = {
      sessionId: record.sessionId,
      requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
      lastActivity: record.time,
    }
    accumulator.bySession.set(record.sessionId, sessionTotals)
  }
  accumulateBucket(sessionTotals, record)
  if (record.time > sessionTotals.lastActivity) {
    sessionTotals.lastActivity = record.time
  }
}

/** Trailing hours the fold keeps in byHour; bounds the wire payload. */
const HOURLY_WINDOW_HOURS = 48

/**
 * Finish a fold: freeze the totals with their display ordering (by-model
 * largest first, by-day ascending, by-hour ascending inside the trailing
 * window).
 *
 * @param accumulator - the completed fold state.
 * @returns a deeply frozen totals snapshot.
 */
export function finishTotals(accumulator: UsageTotalsAccumulator): UsageLedgerTotals {
  const byModel = [...accumulator.byModel.values()].sort((left, right) => {
    if (right.totalTokens !== left.totalTokens) return right.totalTokens - left.totalTokens
    if (left.provider !== right.provider) return left.provider < right.provider ? -1 : 1
    return left.model < right.model ? -1 : 1
  })
  const byDay = [...accumulator.byDay.values()].sort((left, right) => left.day < right.day ? -1 : 1)
  const bySession = [...accumulator.bySession.values()].sort((left, right) => {
    if (right.totalTokens !== left.totalTokens) return right.totalTokens - left.totalTokens
    return left.sessionId < right.sessionId ? -1 : 1
  })
  const byHour = [...accumulator.byHour.values()]
    .sort((left, right) => left.hour < right.hour ? -1 : 1)
    .slice(-HOURLY_WINDOW_HOURS)
  return deepFreeze({
    requests: accumulator.requests,
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    cacheReadTokens: accumulator.cacheReadTokens,
    cacheWriteTokens: accumulator.cacheWriteTokens,
    totalTokens: accumulator.totalTokens,
    byModel,
    byDay,
    byHour,
    bySession,
    lastRecordTime: accumulator.lastRecordTime,
  })
}

/**
 * Fold an ordered record sequence into one totals snapshot.
 *
 * @param records - validated records, in any order.
 * @returns a deeply frozen totals snapshot.
 */
export function foldRecords(records: Iterable<UsageLedgerRecord>): UsageLedgerTotals {
  const accumulator = createAccumulator()
  for (const record of records) accumulateRecord(accumulator, record)
  return finishTotals(accumulator)
}
