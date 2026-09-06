/**
 * Unit behavior of the usage ledger: record encoding and validation, the pure
 * fold, real session-append recording through the service, the totals cache,
 * durability draining, and the command text rendering.
 */

import { mkdtemp, mkdir, readFile, rm, writeFile, appendFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import UsageLedger from '../src/index.ts'
import type { UsageLedgerRecord } from '../src/types.ts'
import { encodeRecordLine, parseRecordLine } from '../src/records.ts'
import { foldRecords } from '../src/fold.ts'
import { displayLedgerPath, formatTokenCount, formatUsageTotals } from '../src/display.ts'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Harness {
  readonly ctx: Context
  readonly ledger: UsageLedger
  readonly path: string
  readonly session: Session
}

/** Mount the real session store and the ledger plugin over a temp root. */
async function harness(): Promise<Harness> {
  root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-'))
  const path = join(root, 'usage', 'usage.jsonl')
  context = new Context()
  await context.plugin(SessionStore)
  await context.plugin(UsageLedger, { path })
  const session = context.sessions.create(SessionId('unit'))
  return { ctx: context, ledger: context.usageLedger, path, session }
}

/** Append one usage-reporting assistant message with the given buckets. */
function appendUsage(
  session: Session,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  route: { provider: string; model: string } = { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
): void {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: route,
    }),
    usage,
  }, { surfaceOp: 'append' })
}

const USAGE_A: TokenUsage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: 1 }

describe('ledger records', () => {
  it('round-trips a record through encode and parse', () => {
    const record: UsageLedgerRecord = {
      version: 1,
      time: 1730000000000,
      sessionId: 's1',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 4,
      cacheWriteTokens: 1,
    }
    const line = encodeRecordLine(record)
    expect(line.split('\n')).toHaveLength(1)
    expect(parseRecordLine(line)).toEqual(record)
  })

  it('rejects damaged, foreign, and ill-typed lines', () => {
    expect(parseRecordLine('')).toBeNull()
    expect(parseRecordLine('   ')).toBeNull()
    expect(parseRecordLine('{not json')).toBeNull()
    expect(parseRecordLine('[1, 2]')).toBeNull()
    expect(parseRecordLine('"a string"')).toBeNull()
    expect(parseRecordLine('{"version":2}')).toBeNull()
    expect(parseRecordLine(JSON.stringify({ version: 1 }))).toBeNull()
    expect(parseRecordLine(JSON.stringify({ version: 1, time: 'soon', sessionId: 's', provider: 'p', model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }))).toBeNull()
    expect(parseRecordLine(JSON.stringify({ version: 1, time: 1, sessionId: '', provider: 'p', model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }))).toBeNull()
    expect(parseRecordLine(JSON.stringify({ version: 1, time: 1, sessionId: 's', provider: 'p', model: 'm', inputTokens: -1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }))).toBeNull()
    expect(parseRecordLine(JSON.stringify({ version: 1, time: 1, sessionId: 's', provider: 'p', model: 'm', inputTokens: 1.5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }))).toBeNull()
    expect(parseRecordLine(JSON.stringify({ version: 1, time: 1, sessionId: 's', provider: 'p', model: 'm', inputTokens: 1, outputTokens: Number.MAX_SAFE_INTEGER + 1, cacheReadTokens: 0, cacheWriteTokens: 0 }))).toBeNull()
  })

  it('tolerates a torn tail line from a crashed writer', () => {
    const good = encodeRecordLine({
      version: 1, time: 1730000000000, sessionId: 's1', provider: 'p', model: 'm',
      inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
    expect(parseRecordLine(good.slice(0, good.length - 4))).toBeNull()
  })
})

describe('usage fold', () => {
  it('derives billed totals and sorts day buckets', () => {
    const records: UsageLedgerRecord[] = [
      { version: 1, time: 1730000000000, sessionId: 's1', provider: 'p1', model: 'm1', inputTokens: 10, outputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: 1 },
      { version: 1, time: 1730000000001, sessionId: 's2', provider: 'p1', model: 'm1', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { version: 1, time: 1730086400000, sessionId: 's1', provider: 'p2', model: 'm2', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]
    const totals = foldRecords(records)
    expect(totals.requests).toBe(3)
    expect(totals.totalTokens).toBe(172)
    expect(totals.byDay.map(entry => entry.day)).toEqual(['2024-10-27', '2024-10-28'])
    expect(totals.byModel[0]).toMatchObject({ provider: 'p2', model: 'm2', totalTokens: 150 })
    expect(totals.bySession.map(entry => entry.sessionId)).toEqual(['s1', 's2'])
    expect(totals.bySession[0]).toMatchObject({ sessionId: 's1', requests: 2, totalTokens: 170, lastActivity: 1730086400000 })
    expect(totals.bySession[1]).toMatchObject({ sessionId: 's2', requests: 1, totalTokens: 2, lastActivity: 1730000000001 })
    expect(totals.byHour.map(entry => entry.hour)).toEqual(['2024-10-27T03', '2024-10-28T03'])
    expect(totals.byHour[0]).toMatchObject({ requests: 2, totalTokens: 22 })
    expect(totals.byHour[1]).toMatchObject({ requests: 1, totalTokens: 150 })
    expect(totals.lastRecordTime).toBe(1730086400000)
    expect(Object.isFrozen(totals)).toBe(true)
    expect(Object.isFrozen(totals.byModel)).toBe(true)
    expect(Object.isFrozen(totals.byModel[0])).toBe(true)
    expect(Object.isFrozen(totals.byHour)).toBe(true)
    expect(Object.isFrozen(totals.byHour[0])).toBe(true)
    expect(Object.isFrozen(totals.bySession)).toBe(true)
    expect(Object.isFrozen(totals.bySession[0])).toBe(true)
  })

  it('keeps only the trailing 48 hourly buckets, ascending', () => {
    const records: UsageLedgerRecord[] = []
    for (let index = 0; index < 50; index++) {
      records.push({
        version: 1, time: Date.now() - (49 - index) * 3_600_000, sessionId: 's', provider: 'p', model: 'm',
        inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      })
    }
    const totals = foldRecords(records)
    expect(totals.byHour).toHaveLength(48)
    const hours = totals.byHour.map(entry => entry.hour)
    expect([...hours].sort((left, right) => left < right ? -1 : 1)).toEqual(hours)
    expect(hours[0]).toBe(new Date(Date.now() - 47 * 3_600_000).toISOString().slice(0, 13))
  })

  it('merges records inside one hour into a single bucket', () => {
    const base = Date.now() - 120_000
    const records: UsageLedgerRecord[] = [
      { version: 1, time: base, sessionId: 's', provider: 'p', model: 'm', inputTokens: 2, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { version: 1, time: base + 60_000, sessionId: 's', provider: 'p', model: 'm', inputTokens: 3, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]
    const totals = foldRecords(records)
    expect(totals.byHour).toHaveLength(1)
    expect(totals.byHour[0]).toMatchObject({ requests: 2, inputTokens: 5 })
  })

  it('breaks total-tokens session ties by session id and tracks last activity', () => {
    const records: UsageLedgerRecord[] = [
      { version: 1, time: 2, sessionId: 'session-b', provider: 'p', model: 'm', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { version: 1, time: 7, sessionId: 'session-a', provider: 'p', model: 'm', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { version: 1, time: 3, sessionId: 'session-a', provider: 'p', model: 'm', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]
    const totals = foldRecords(records)
    expect(totals.bySession.map(entry => entry.sessionId)).toEqual(['session-a', 'session-b'])
    expect(totals.bySession[0]).toMatchObject({ requests: 2, lastActivity: 7 })
  })

  it('breaks total-tokens ties by route name', () => {
    const records: UsageLedgerRecord[] = [
      { version: 1, time: 1, sessionId: 's', provider: 'b', model: 'm', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { version: 1, time: 2, sessionId: 's', provider: 'a', model: 'z', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]
    const totals = foldRecords(records)
    expect(totals.byModel.map(entry => entry.provider)).toEqual(['a', 'b'])
  })

  it('orders providers ascending on ties regardless of fold order', () => {
    const build = (providers: readonly string[]) => providers.map((provider, index) => ({
      version: 1 as const, time: index + 1, sessionId: 's', provider, model: 'm',
      inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    }))
    expect(foldRecords(build(['a', 'b'])).byModel.map(entry => entry.provider)).toEqual(['a', 'b'])
  })

  it('orders equal-provider routes by model in both directions', () => {
    const build = (models: readonly string[]) => models.map((model, index) => ({
      version: 1 as const, time: index + 1, sessionId: 's', provider: 'p', model,
      inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    }))
    // Insertion order reversed per case exercises both comparator paths.
    expect(foldRecords(build(['b', 'a'])).byModel.map(entry => entry.model)).toEqual(['a', 'b'])
    expect(foldRecords(build(['a', 'b'])).byModel.map(entry => entry.model)).toEqual(['a', 'b'])
  })

  it('sorts day buckets descending when records arrive out of order', () => {
    const records: UsageLedgerRecord[] = [
      { version: 1, time: 1730086400000, sessionId: 's', provider: 'p', model: 'm', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { version: 1, time: 1730000000000, sessionId: 's', provider: 'p', model: 'm', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]
    const totals = foldRecords(records)
    expect(totals.byDay.map(entry => entry.day)).toEqual(['2024-10-27', '2024-10-28'])
  })
})

describe('usage ledger service', () => {
  it('records billed assistant messages and serves totals', async () => {
    const { ctx, ledger, session, path } = await harness()
    appendUsage(session, USAGE_A)
    appendUsage(ctx.sessions.create(SessionId('second')), USAGE_A)
    // The real durability checkpoint, as the checkpoint policy dispatches it.
    await expect(ctx.sessions.flush(session)).resolves.toBe(true)
    const totals = await ledger.totals()
    expect(totals.requests).toBe(2)
    expect(totals.inputTokens).toBe(20)
    expect(totals.outputTokens).toBe(10)
    expect(totals.cacheReadTokens).toBe(8)
    expect(totals.cacheWriteTokens).toBe(2)
    expect(totals.totalTokens).toBe(40)
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(parseRecordLine(lines[0] ?? '')).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4-flash', inputTokens: 10, outputTokens: 5 })
  })

  it('skips assistant messages without usage', async () => {
    const { ledger, session } = await harness()
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'no accounting' }],
        source: { provider: 'p', model: 'm' },
      }),
    }, { surfaceOp: 'append' })
    await ledger.flush()
    expect((await ledger.totals()).requests).toBe(0)
  })

  it('attributes interrupted messages with usage to their route', async () => {
    const { ledger, session } = await harness()
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'prefix' }],
        source: { provider: 'p', model: 'interrupted' },
      }),
      usage: { inputTokens: 7, outputTokens: 2 },
      interrupted: true,
    }, { surfaceOp: 'append' })
    await ledger.flush()
    const totals = await ledger.totals()
    expect(totals.requests).toBe(1)
    expect(totals.byModel[0]).toMatchObject({ provider: 'p', model: 'interrupted', totalTokens: 9 })
  })

  it('folds an existing ledger at boot and tolerates damaged lines', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-boot-'))
    const path = join(root, 'usage.jsonl')
    const good = encodeRecordLine({ version: 1, time: 1000, sessionId: 'old', provider: 'p', model: 'm', inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })
    await writeFile(path, good + '\n' + '{"torn line' + '\n' + 'not json\n' + good + '\n')
    context = new Context()
    await context.plugin(UsageLedger, { path })
    const ledger = context.usageLedger
    const totals = await ledger.totals()
    expect(totals.requests).toBe(2)
    expect(totals.totalTokens).toBe(20)
  })

  it('refolds when another process appends to the file', async () => {
    const { ledger, path } = await harness()
    expect(await ledger.totals()).toMatchObject({ requests: 0 })
    const external = encodeRecordLine({ version: 1, time: 2000, sessionId: 'other', provider: 'x', model: 'y', inputTokens: 50, outputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0 })
    await appendFile(path, external + '\n')
    const totals = await ledger.totals()
    expect(totals.requests).toBe(1)
    expect(totals.totalTokens).toBe(75)
  })

  it('serves empty totals before the file exists', async () => {
    const { ledger, session } = await harness()
    const totals = await ledger.totals()
    expect(totals.requests).toBe(0)
    expect(totals.byModel).toEqual([])
    expect(totals.byDay).toEqual([])
    expect(totals.byHour).toEqual([])
    expect(totals.bySession).toEqual([])
    expect(totals.lastRecordTime).toBeNull()
    appendUsage(session, USAGE_A)
    await ledger.flush()
    expect((await ledger.totals()).requests).toBe(1)
  })

  it('rejects a relative configured path at load', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-rel-'))
    context = new Context()
    await expect(context.plugin(UsageLedger, { path: 'relative/usage.jsonl' }))
      .rejects.toThrow('must be absolute')
  })

  it('rejects a configured directory at load', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-dir-'))
    const dir = join(root, 'usage-dir')
    await mkdir(dir)
    context = new Context()
    await expect(context.plugin(UsageLedger, { path: dir })).rejects.toThrow('is a directory')
  })

  it('expands a home tilde against the harness home', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-tilde-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      context = new Context()
      await context.plugin(SessionStore)
      await context.plugin(UsageLedger, { path: '~/ledger/usage.jsonl' })
      const session = context.sessions.create(SessionId('tilde'))
      appendUsage(session, USAGE_A)
      await context.usageLedger.flush()
      const stored = await readFile(join(root, 'ledger', 'usage.jsonl'), 'utf8')
      expect(parseRecordLine(stored.trim())).toMatchObject({ inputTokens: 10 })
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })

  it('keeps the chain alive after a failed append', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-ro-'))
    const path = join(root, 'readonly.jsonl')
    await writeFile(path, '', { mode: 0o444 })
    await chmod(path, 0o444)
    context = new Context()
    await context.plugin(SessionStore)
    await context.plugin(UsageLedger, { path })
    const ledger = context.usageLedger
    const session = context.sessions.create(SessionId('ro'))
    appendUsage(session, USAGE_A)
    await expect(ledger.flush()).resolves.toBeUndefined()
    // A later record still flows through the same chain.
    appendUsage(session, USAGE_A)
    await expect(ledger.flush()).resolves.toBeUndefined()
    expect((await ledger.totals()).requests).toBe(0)
  })

  it('drains pending records on disposal', async () => {
    const { ctx, path } = await harness()
    appendUsage(ctx.sessions.create(SessionId('dispose')), USAGE_A)
    await ctx.fiber.dispose()
    context = undefined
    const stored = await readFile(path, 'utf8')
    expect(stored.trim().split('\n')).toHaveLength(1)
  })

  it('serves frozen totals from the cache on unchanged files', async () => {
    const { ledger, session } = await harness()
    appendUsage(session, USAGE_A)
    await ledger.flush()
    const first = await ledger.totals()
    const second = await ledger.totals()
    expect(second).toBe(first)
  })

  it('rejects a ledger path under a regular file at load', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-notdir-'))
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'occupied')
    context = new Context()
    // statSync hits ENOTDIR, which is not absence, so load fails loud.
    await expect(context.plugin(UsageLedger, { path: join(blocker, 'usage.jsonl') }))
      .rejects.toThrow()
  })

  it('surfaces non-absence stat failures from totals', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-stat-'))
    const parent = join(root, 'sealed')
    await mkdir(parent)
    const path = join(parent, 'usage.jsonl')
    context = new Context()
    await context.plugin(UsageLedger, { path })
    const ledger = context.usageLedger
    await chmod(parent, 0o000)
    try {
      await expect(ledger.totals()).rejects.toThrow()
    } finally {
      await chmod(parent, 0o755)
    }
  })
})

describe('usage command text', () => {
  it('renders an empty ledger message', () => {
    const text = formatUsageTotals(foldRecords([]), '~/.dsh/usage/usage.jsonl')
    expect(text).toContain('No token usage recorded yet')
    expect(text).toContain('~/.dsh/usage/usage.jsonl')
  })

  it('omits the Today line when no record falls on the current day', () => {
    const records: UsageLedgerRecord[] = [
      { version: 1, time: 1730000000000, sessionId: 's1', provider: 'p', model: 'm', inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]
    const text = formatUsageTotals(foldRecords(records), 'ledger')
    expect(text).not.toContain('Today')
    expect(text).not.toContain('Last 24 hours')
    expect(text).toContain('By model:')
  })

  it('renders totals with today, models, and humanized counts', () => {
    const records: UsageLedgerRecord[] = [
      { version: 1, time: Date.now(), sessionId: 's1', provider: 'deepseek-official', model: 'deepseek-v4-flash', inputTokens: 1_500_000, outputTokens: 250_000, cacheReadTokens: 987_654, cacheWriteTokens: 0 },
      { version: 1, time: Date.now(), sessionId: 's2', provider: 'pi', model: 'gateway-model', inputTokens: 942, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]
    const totals = foldRecords(records)
    const text = formatUsageTotals(totals, '~/.dsh/usage/usage.jsonl')
    expect(text).toContain('Requests 2')
    expect(text).toContain('Input 1.5M')
    expect(text).toContain('Cache read 987.7K')
    expect(text).toContain('Output 250K')
    expect(text).toContain('Today (UTC ')
    expect(text).toContain('Last 24 hours (UTC): 2 requests · 2.7M tokens')
    expect(text).toContain('deepseek-official/deepseek-v4-flash')
    expect(text).toContain('pi/gateway-model')
    expect(text).toContain('By session:')
    expect(text).toContain('s1 — 1 requests · 2.7M tokens · last ' + new Date().toISOString().slice(0, 10))
    expect(text).toContain('s2 — 1 requests · 952 tokens')
    expect(text).not.toContain('more route')
    expect(text).not.toContain('more session')
  })

  it('summarizes routes beyond the display cap', () => {
    const records: UsageLedgerRecord[] = []
    for (let index = 0; index < 7; index++) {
      const suffix = String(index)
      records.push({ version: 1, time: Date.now(), sessionId: 's'.concat(suffix), provider: 'p', model: 'm'.concat(suffix), inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    }
    const text = formatUsageTotals(foldRecords(records), 'ledger')
    expect(text).toContain('… and 2 more routes')
  })

  it('uses the singular for one hidden route', () => {
    const records: UsageLedgerRecord[] = []
    for (let index = 0; index < 6; index++) {
      const suffix = String(index)
      records.push({ version: 1, time: Date.now(), sessionId: 's'.concat(suffix), provider: 'p', model: 'm'.concat(suffix), inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    }
    const text = formatUsageTotals(foldRecords(records), 'ledger')
    // The session section now trails the route summary.
    expect(text).toContain('… and 1 more route')
  })

  it('summarizes sessions beyond the display cap and strips the session prefix', () => {
    const records: UsageLedgerRecord[] = []
    for (let index = 0; index < 7; index++) {
      records.push({ version: 1, time: Date.now(), sessionId: 'session-id-'.concat(String(index)), provider: 'p', model: 'm', inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    }
    const text = formatUsageTotals(foldRecords(records), 'ledger')
    expect(text).toContain('id-0 — 1 requests · 10 tokens')
    expect(text.endsWith('… and 2 more sessions')).toBe(true)
  })

  it('uses the singular for one hidden session', () => {
    const records: UsageLedgerRecord[] = []
    for (let index = 0; index < 6; index++) {
      records.push({ version: 1, time: Date.now(), sessionId: 'session-id-'.concat(String(index)), provider: 'p', model: 'm', inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    }
    const text = formatUsageTotals(foldRecords(records), 'ledger')
    expect(text.endsWith('… and 1 more session')).toBe(true)
  })

  it('keeps a session id verbatim when the session- prefix is absent', () => {
    const records: UsageLedgerRecord[] = [
      { version: 1, time: Date.now(), sessionId: 'plain-id', provider: 'p', model: 'm', inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]
    const text = formatUsageTotals(foldRecords(records), 'ledger')
    expect(text).toContain('plain-id — 1 requests · 10 tokens')
  })

  it('formats exact counts below one thousand', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1000)).toBe('1K')
    expect(formatTokenCount(1_000_000)).toBe('1M')
    expect(formatTokenCount(1_234_567)).toBe('1.2M')
  })

  it('scales beyond one billion through two-decimal B and T tiers', () => {
    expect(formatTokenCount(486_635_710)).toBe('486.6M')
    expect(formatTokenCount(1_000_000_000)).toBe('1B')
    expect(formatTokenCount(2_530_000_000)).toBe('2.53B')
    expect(formatTokenCount(1_000_000_000_000)).toBe('1T')
    expect(formatTokenCount(1_253_000_000_000)).toBe('1.25T')
    expect(formatTokenCount(1_250_100_000_000)).toBe('1.25T')
  })

  it('renders home-relative ledger paths symbolically', () => {
    root = root ?? undefined
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = '/tmp/dsh-usage-display-home'
    try {
      expect(displayLedgerPath(dshHomePath('usage', 'usage.jsonl'))).toBe('$DSH_HOME/usage/usage.jsonl')
      expect(displayLedgerPath('/elsewhere/usage.jsonl')).toBe('/elsewhere/usage.jsonl')
      expect(displayLedgerPath(process.env.DSH_HOME ?? '')).toBe('$DSH_HOME')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })
})
