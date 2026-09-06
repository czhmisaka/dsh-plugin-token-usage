/**
 * Durable cross-session token usage ledger. Every usage-reporting
 * assistant/message event lands as one JSON line in an append-only ledger file
 * under the Harness home, in real time: the append starts when the event
 * commits, and the awaited session/flush checkpoint drains it. The service
 * folds the file into whole-ledger totals on demand and registers the /usage
 * command when a command registry is composed.
 *
 * @module @deepseek-ai/dsh-usage-ledger
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { mkdirSync, statSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
// Type-only: activates the ctx.commands Context declaration for the command child.
import type {} from '@deepseek-ai/dsh-commands'
import { displayLedgerPath, formatUsageTotals } from './display.ts'
import { createAccumulator, accumulateRecord, finishTotals } from './fold.ts'
import { encodeRecordLine, parseRecordLine } from './records.ts'
import type { UsageLedgerRecord, UsageLedgerSnapshot, UsageLedgerTotals } from './types.ts'

export type * from './types.ts'

/** Plugin label for Cordis effect and log prefixes. */
const PLUGIN_LABEL = 'dsh-usage-ledger'

/** Loader config: where the append-only usage ledger file lives. */
export interface Config {
  /**
   * Absolute path of the append-only JSONL ledger file. Required (no default):
   * a default would scatter usage data beside whatever the process treats as
   * its working directory. The shipped base bundle supplies
   * `dshHomePath('usage', 'usage.jsonl')`. An existing target must be a
   * regular file; the parent directory is created at load when missing.
   */
  path: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageLedger: UsageLedger
  }
}

/**
 * Read one session event's billed usage into a ledger record, or null when the
 * event carries no provider-reported token accounting. Route attribution reads
 * the assembled assistant message's source; interrupted messages count,
 * because a delivered prefix is billed.
 *
 * @param session - the session whose log appended the event.
 * @param event - the committed event.
 * @returns the record, or null when nothing is billed here.
 */
function recordFromEvent(session: Session, event: SessionEvent): UsageLedgerRecord | null {
  if (event.type !== 'assistant/message') return null
  const usage: TokenUsage | undefined = event.data.usage
  if (usage === undefined) return null
  return {
    version: 1,
    time: event.time,
    sessionId: session.id,
    provider: event.data.message.source.provider,
    model: event.data.message.source.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/**
 * The cross-session usage ledger service. Load as a plugin; it registers as
 * ctx.usageLedger, appends every billed model call to the ledger file in real
 * time, and serves whole-ledger totals to hosts and web clients.
 */
export class UsageLedger extends TypertRemoteService {
  static Config: z<Config> = z.object({
    path: z.string().required(),
  })

  /** Resolved absolute ledger file path. */
  private readonly path: string

  /** Serialized append chain; queued records reach the file in commit order. */
  private chain: Promise<void> = Promise.resolve()

  /** Lazily opened append handle; one writer per service instance. */
  private handle: FileHandle | undefined

  /** File identity the cached totals fold covers; size -1 means no file yet. */
  private folded: { size: number; mtimeMs: number; totals: UsageLedgerTotals } | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'usageLedger', { namespace: 'usage' })
    const path = resolveLedgerPath(config.path)
    // Fail loud at load: an unusable ledger target is misconfiguration, not a
    // first-append surprise.
    if (statOrUndefined(path)?.isDirectory()) {
      throw new Error(PLUGIN_LABEL + ': configured ledger path is a directory: ' + path)
    }
    mkdirSync(dirname(path), { recursive: true })
    this.path = path

    ctx.on('session/event', (session, event) => {
      const record = recordFromEvent(session, event)
      if (record !== null) this.appendRecord(record)
    })
    ctx.on('session/flush', () => this.flush())
    ctx.effect(() => this.dispose(), 'usage-ledger: drain and close ledger file')

    // The command child activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'usage',
        description: 'Show total token usage across all sessions',
        handler: async () => ({ kind: 'success' as const, text: await this.commandText() }),
      })
    })
  }

  /**
   * Aggregate whole-ledger token usage. Folds the ledger file when its size or
   * mtime moved past the cached fold — including writes from other processes
   * sharing the harness home — and serves the cached snapshot otherwise.
   *
   * @returns a deeply frozen totals snapshot at one file state.
   */
  async totals(): Promise<UsageLedgerTotals> {
    const stats = await stat(this.path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
      throw error
    })
    if (stats === undefined) {
      return this.cacheTotals(-1, -1, finishTotals(createAccumulator()))
    }
    if (this.folded !== undefined && this.folded.size === stats.size && this.folded.mtimeMs === stats.mtimeMs) {
      return this.folded.totals
    }
    return this.cacheTotals(stats.size, stats.mtimeMs, await this.foldFile())
  }

  /**
   * Wire export of {@link totals} for the Client usage dashboard.
   * @param signal - carrier cancellation, always the final parameter.
   * @returns a JSON-serializable frozen usage snapshot.
   */
  @Remote('totals')
  async remoteExportTotals(signal: AbortSignal): Promise<UsageLedgerSnapshot> {
    signal.throwIfAborted()
    return { totals: await this.totals(), ledgerDisplay: displayLedgerPath(this.path) }
  }

  /**
   * Resolve when every queued record has reached the ledger file. The
   * session/flush subscription awaits this on the session log's durability
   * checkpoint, and hosts may await it before reading the file directly.
   *
   * @returns a promise settling after every pending append settles.
   */
  flush(): Promise<void> {
    return this.chain
  }

  /** Queue one append on the serialized chain; failures log and never throw. */
  private appendRecord(record: UsageLedgerRecord): void {
    const line = encodeRecordLine(record) + '\n'
    this.chain = this.chain.then(() => this.writeLine(line)).catch((error: unknown) => {
      this.ctx.logger.error('%s: failed to append usage record: %o', PLUGIN_LABEL, error)
    })
  }

  /** Write one line through the lazily opened append handle. */
  private async writeLine(line: string): Promise<void> {
    if (this.handle === undefined) this.handle = await open(this.path, 'a')
    await this.handle.write(line)
  }

  /**
   * Fold the whole ledger file; parseRecordLine skips damaged lines. The file
   * is read whole — one buffered read avoids the readline module, which the
   * packed webworker image does not carry — and every line is one small JSON
   * record, so the fold is O(records) in time and memory.
   */
  private async foldFile(): Promise<UsageLedgerTotals> {
    const accumulator = createAccumulator()
    const content = await readFile(this.path, 'utf8')
    for (const line of content.split('\n')) {
      const record = parseRecordLine(line)
      if (record !== null) accumulateRecord(accumulator, record)
    }
    return finishTotals(accumulator)
  }

  /** Cache and return one totals value. */
  private cacheTotals(size: number, mtimeMs: number, totals: UsageLedgerTotals): UsageLedgerTotals {
    this.folded = { size, mtimeMs, totals }
    return totals
  }

  /** Disposer: drain the pending chain, then close the handle. */
  private dispose(): () => Promise<void> {
    return async () => {
      await this.chain
      await this.handle?.close()
      this.handle = undefined
    }
  }

  /** Build the /usage command text from one fresh totals fold. */
  private async commandText(): Promise<string> {
    const totals = await this.totals()
    return formatUsageTotals(totals, displayLedgerPath(this.path))
  }
}

/** stat() that maps absence to undefined and surfaces every other error. */
function statOrUndefined(path: string): Stats | undefined {
  try {
    return statSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    throw error
  }
}

/** Validate the configured ledger path: tilde expansion, then absolute form. */
function resolveLedgerPath(path: string): string {
  const expanded = path === '~' || path.startsWith('~/') ? dshHomePath(path.slice(1)) : path
  if (!isAbsolute(expanded)) {
    throw new Error(PLUGIN_LABEL + ': configured ledger path must be absolute, got "' + path + '"')
  }
  return expanded
}

export default UsageLedger
