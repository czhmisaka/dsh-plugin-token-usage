/**
 * Ledger record encoding and validation. Lines are the durable format: one
 * JSON object per line. Every field a fold reads is validated here, so one
 * torn or foreign line skips exactly itself instead of failing the boot fold.
 *
 * @module @deepseek-ai/dsh-usage-ledger/records
 */

import type { UsageLedgerRecord } from './types.ts'

/** Version literal written into every appended record. */
export const LEDGER_RECORD_VERSION = 1

/**
 * Encode one record as its single-line JSON form, without the trailing
 * newline the writer adds.
 *
 * @param record - the record to append.
 * @returns the JSON line.
 */
export function encodeRecordLine(record: UsageLedgerRecord): string {
  return JSON.stringify(record)
}

/** Whether a value is a non-negative safe integer. */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Whether a value is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Parse and validate one ledger line. Any structural deviation — invalid
 * JSON, a foreign version, a missing or ill-typed field, a negative or
 * unsafe count — yields null, so one damaged line skips exactly itself.
 *
 * @param line - raw line from the ledger file, without its newline.
 * @returns the validated record, or null when the line is not one.
 */
export function parseRecordLine(line: string): UsageLedgerRecord | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record.version !== 1) return null
  if (!isNonNegativeSafeInteger(record.time)) return null
  if (!isNonEmptyString(record.sessionId) || !isNonEmptyString(record.provider) || !isNonEmptyString(record.model)) return null
  if (!isNonNegativeSafeInteger(record.inputTokens) || !isNonNegativeSafeInteger(record.outputTokens)
    || !isNonNegativeSafeInteger(record.cacheReadTokens) || !isNonNegativeSafeInteger(record.cacheWriteTokens)) return null
  return {
    version: 1,
    time: record.time,
    sessionId: record.sessionId,
    provider: record.provider,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
  }
}
