---
description: "The web usage dashboard for users and maintainers reading whole-deployment token accounting from the settings panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-usage

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-client-ui-usage` is the browser half of the token usage ledger: it registers the **Usage** settings section and renders the whole-deployment dashboard — all-time figures, today's totals, a usage-over-time chart, the per-route table, and the per-session table — from `ctx.remote.usage.totals()`. The section fetches on mount and on the user's Refresh affordance; the ledger changes on every model call, and the button is the currency affordance. It owns no settings document, writes nothing, and adds no model-visible surface.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in the web composition beside the settings shell and the Remote assembly; the shipped `dsh-web-app` bundle mounts it. The section appears in the settings panel's navigation once composed, and renders nothing when the Host does not serve the `usage` namespace (compositions without `dsh-usage-ledger`).

### Composition

```yaml
- name: '@deepseek-ai/dsh-client-ui-usage'
```

### What the dashboard renders

- **All time** — request count and the four disjoint token buckets plus the billed total, in compact humanized form.
- **Today (UTC)** — today's requests and total, or a no-usage note.
- **Usage over time** — a calendar-aligned area chart with a 24-hours / 7-day / 30-day range toggle: hourly buckets over the trailing day, daily totals beyond. Buckets without usage read as zero, and the axis always ends at the current hour or today (UTC).
- **By model** — the top eight routes with requests and total tokens, plus a remainder line.
- **By session** — the top ten sessions with requests, total tokens, and each session's latest activity day (UTC), plus a remainder line; the row's hover title carries the full session id.
- **Ledger file** — the symbolic ledger location (`~/.dsh/...` or `$DSH_HOME/...`).

A failed Remote call renders the failure code with a Refresh affordance; a local fault keeps crashing per the Remote discipline.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Registers the dictionaries and the `settings.section` entry with the load face |
| [`src/client/usage-section.tsx`](src/client/usage-section.tsx) | The section component: fetch state, figures grid, time chart, route and session tables |
| [`src/client/shaping.ts`](src/client/shaping.ts) | Pure snapshot-to-view shaping: compact counts, the daily series, route and session capping |
| [`src/client/locales.ts`](src/client/locales.ts) | The typed zh/en dictionaries |

### Data flow

The inject face exposes one `load` callback closed over `ctx.remote.usage.totals()`. The component holds fetch state locally (loading / failed / ready), derives the whole view with one `shapeDashboard` call inside the ready state, and re-fetches only through the user's Refresh. There is no subscription: the ledger moves on every model call, and a live-updating counter would re-render the panel on unrelated traffic.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Token and KV Cache effects

#### What the model sees

Nothing. The section reads a Remote endpoint and renders HTML; it contributes no prompt section, tool, message, or session event.

#### Token effect

The dashboard adds no model requests. Every figure it renders mirrors the `TokenUsage` the adapter already reported and the ledger already recorded.

#### KV Cache effect

No effect. The section contributes no request content, so cache identity is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where the dashboard stops and future work begins. They are current package constraints, not a comparison of display approaches or a task backlog.

- **No live updates** — the panel fetches on mount and on Refresh; a live-updating counter is deferred until a consumer needs it, because the ledger changes on every model call.
- **Time resolution is UTC buckets** — the 7/30-day views fold per UTC calendar day and the 24-hour view per UTC hour; the ledger keeps hourly buckets only over its trailing 48-hour window, so hour-level history beyond that is not retained.
- **Route table is capped at eight rows** — the remainder renders as a count; per-route pagination belongs to a fuller explorer surface.
- **Session rows show ids, not titles** — the ledger records session ids only, so the table labels carry the id prefix and the hover title the full id; human-readable session titles belong to a richer query surface.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: notes for maintainers and open questions. Shipped behavior and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- The compact number forms are locale-neutral by design and match the `/usage` command text, so both surfaces read alike; a locale-aware formatter would make the two disagree.
- No `./invariant` companion: the section renders one Remote read through a pure fold, and the display relations (figures sum, trend scaling) are covered by the package specs.

</details>
