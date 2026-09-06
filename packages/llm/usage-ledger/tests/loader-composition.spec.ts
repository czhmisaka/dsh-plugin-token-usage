/**
 * REAL-composition proof: the shipped YAML shape (session + agent + commands +
 * usage-ledger) boots through the vendored Loader, a logged turn with provider
 * usage reaches the durable ledger file, and the /usage command serves the
 * totals to a dispatching UI through the real command registry.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as UsageLedgerPlugin from '../src/index.ts'

let root: string | undefined
let context: Context | undefined
let ledgerPath: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  ledgerPath = undefined
})

/** Boot the shipped composition shape through the vendored Loader. */
async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-usage-ledger', UsageLedgerPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** Build a live idle agent accepted by the command executor. */
function stubAgent(ctx: Context, id: string): { agent: Agent; session: ReturnType<Context['sessions']['create']> } {
  const session = ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  ctx.agents.register(agent)
  return { agent, session }
}

describe('real Loader composition', () => {
  it('boots the shipped shape, records usage durably, and serves /usage', async () => {
    ledgerPath = join(tmpdir(), ['dsh-usage-ledger-file-', String(Date.now()), '.jsonl'].join(''))
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-usage-ledger'",
      '  config:',
      '    path: ' + JSON.stringify(ledgerPath),
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const session = loaded.sessions.create(SessionId('composed'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'composed' }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 1234, outputTokens: 567, cacheReadTokens: 8 },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await loaded.usageLedger.flush()

    const stored = await readFile(ledgerPath, 'utf8')
    expect(stored.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(stored)).toMatchObject({
      version: 1,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      inputTokens: 1234,
      outputTokens: 567,
      cacheReadTokens: 8,
      cacheWriteTokens: 0,
    })

    const { agent } = stubAgent(loaded, 'composed-agent')
    const definition = loaded.commands.find(agent, 'usage')
    expect(definition?.description).toContain('token usage')
    const execution = await loaded.commands.execute(agent, '/usage', [], new AbortController().signal)
    expect(execution?.result.kind).toBe('success')
    const text = execution?.result.kind === 'success' ? execution.result.text : ''
    expect(text).toContain('Requests 1')
    expect(text).toContain('deepseek-official/deepseek-v4-flash')
  })
})
