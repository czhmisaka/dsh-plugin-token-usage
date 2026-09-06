/**
 * Usage settings surface, browser half — the whole-deployment token dashboard
 * settings section plus the always-visible usage bubble (shell overlay) that
 * every session sees, both fed by ctx.usageLedger's wire totals.
 *
 * Surfaces fetch on mount, on expand, and on the user's refresh; there is no
 * live subscription: the ledger changes on every model call, and the refresh
 * affordances are the currency mechanism.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the layout shell's SlotMap merge (the 'shell.overlay' entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge with the generated usage namespace.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { UsageLoad } from './usage-section.tsx'
import { UsageSection } from './usage-section.tsx'
import { UsageBubble } from './usage-bubble.tsx'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'usage'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.usage']

/**
 * Mount the Usage settings section and the all-sessions usage bubble.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-usage: section dictionaries')

  const load = async (): Promise<UsageLoad> => {
    const result = await ctx.remote.usage.totals()
    if (!result.ok) return { ok: false, code: result.error.code, detail: result.error.message }
    return { ok: true, snapshot: result.value }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ load }),
  }, UsageSection))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'usage-bubble',
    order: 50,
    locale: NS,
    inject: () => ({ load }),
  }, UsageBubble))
}
