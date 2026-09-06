---
description: "The durable cross-session token usage ledger for users and maintainers recording, querying, and displaying whole-deployment token usage."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-ledger

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-usage-ledger` records every billed model call across the whole harness deployment: each usage-reporting `assistant/message` event lands as one JSON line in an append-only ledger file under the Harness home, in real time, and `ctx.usageLedger` folds the file into whole-ledger totals — all-time, per route, per UTC day, per UTC hour over a trailing 48-hour window, and per session — served through the `/usage` command. The ledger is durable cross-session accounting: it survives paging, compaction, session deletion, and process restarts, and it is independent of the per-session `tokenUsage` projection that `dsh-token-meter` serves. It adds no prompt, message, schema, or tool of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside the session store when the deployment should keep a durable record of its total token usage. The shipped `dsh-base` bundle mounts it over `dshHomePath('usage', 'usage.jsonl')`, so every base-backed profile records by default; a deployment redirects the file through the row's `path` config.

### Composition

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-usage-ledger'
  config:
    path: !!js dshHomePath('usage', 'usage.jsonl')
```

`path` is required and must be absolute after tilde expansion (`~/...` expands against the harness home). An existing target must be a regular file; the parent directory is created at load. A relative path, a directory target, or a target under a regular file fails the plugin load loud.

### What the ledger records

One record per `assistant/message` event whose adapter reported token accounting: the append time, session id, provider and model from the assembled message's source, and the four disjoint token buckets (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`). Interrupted messages count — a delivered prefix is billed. Messages without usage, and every other event type, record nothing. Retried attempts bill once: only the attempt that assembled the final message carries usage in the durable log.

### Real-time and durability

The append chain starts the moment the event commits, so the file reflects each call within milliseconds. The awaited `session/flush` durability checkpoint drains the chain, so the ledger loses exactly the records a crash also loses from the session log itself. Hosts that read the file directly may await `ctx.usageLedger.flush()` first. Disposal drains pending records before closing the file.

### Reading totals

`ctx.usageLedger.totals()` returns a deeply frozen snapshot: grand totals, per-route totals sorted largest first, per-UTC-day totals ascending, per-UTC-hour totals ascending over the trailing 48 hours, per-session totals sorted largest first with each session's newest record time, and the newest record time. The fold re-reads the ledger file when its size or mtime moved past the cached fold — including appends from another process sharing the harness home — and serves the cached snapshot otherwise.

### The /usage command

When a command registry is composed, the plugin registers the global `/usage` command. It renders the all-time figures, today's UTC figures, a trailing-24-hour summary, the top five routes, and the top five sessions with their latest activity day; an empty ledger renders a pointer to the file instead.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the ledger; the observable behavior is fully covered in [Use this package](#use-this-package).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The service plugin: firehose listener, serialized append chain, totals fold, /usage registration |
| [`src/records.ts`](src/records.ts) | Record line encoding and line-level validation |
| [`src/fold.ts`](src/fold.ts) | The pure record-to-totals fold |
| [`src/display.ts`](src/display.ts) | Command text rendering and symbolic path display |
| [`src/types.ts`](src/types.ts) | Record and totals vocabulary |

### Write path

`session/event` is a post-commit firehose, so record shaping must stay synchronous: the listener folds the event into a record and chains one `write()` onto a serialized promise. The chain keeps commit order, survives write failures (logged, never thrown), and the file handle opens lazily on the first append. Records interleave safely when several profiles share one harness home: each line is one atomic `O_APPEND` write.

### Read path

The totals fold streams the file through a line reader and skips exactly the lines that fail validation — a torn tail line from a crashed writer skips itself, not the file. Bucket totals derive as `input + cacheRead + cacheWrite + output`, the same billed-total convention `dsh-token-meter` folds with.

### What the ledger is not

It is not per-session state: projections fold one session's log, while this ledger accumulates across every session the process observes, including subagent and workflow children. Seed events do not traverse the firehose, so resume and fork never double-count. It is also not a redaction or disclosure surface — records carry no message content, only counts and route identity.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Token meter](../token-meter/README.md) — the replay-aware per-session measurement service and its `tokenUsage` projection.
- [Session stats](../../session/session-stats/README.md) — the per-session conversation figures projection.
- [Session persistence subsystem](../../../docs/subsystems/persistence.md) — the flush checkpoint semantics this ledger aligns with.
- [Home paths](../../util/home-paths/README.md) — how `dshHomePath` resolves the ledger root.

-----

<a id="model-experience"></a>
## Model Experience

### Token and KV Cache effects

#### What the model sees

Nothing. The ledger listens to the event stream, appends its own file, and registers the one `/usage` human command on `ctx.usageLedger`; no prompt section, tool schema, message, or context injection exists.

#### Token effect

The ledger adds no model requests. Each `TokenUsage` record mirrors the usage the adapter already reported for one assembled message; its totals equal the deployment's provider-billed token accounting.

#### KV Cache effect

No effect. The ledger contributes no request content, so cache identity is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where the ledger stops and future work begins. They are current package constraints, not a comparison of accounting approaches or a task backlog.

- **Totals are append-time facts** — the ledger records what the durable log reports per attempt; provider-side billing adjustments and usage on failed attempts that report no accounting are invisible to it.
- **Day buckets are UTC** — the durable day key is the record time's UTC calendar day, by design; local-time views remain a display concern.
- **totals() is a fold-time snapshot** — records another process appends during the fold are not reflected until the next call observes a changed file.
- **No query API yet** — the service exposes whole-ledger totals, including the fixed per-session breakdown; time-window or filtered breakdowns require reading the JSONL file directly until a query surface needs them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: notes for maintainers and open questions. Shipped behavior and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- The record schema is version-stamped (`version: 1`) so a future layout can bump the field and keep the boot fold strict; the fold skips records it cannot validate rather than failing the boot.
- No `./invariant` companion: the ledger's owned relationships are observable only through the same file the service reads; see the runtime invariant statement below.

</details>

**Runtime invariant:** No companion is published. The relationships the ledger owns (one record per billed `assistant/message` event, totals equal to the folded ledger file) are observable only through the same append-only file this service writes and reads, so no independent observation can diverge; the record schema gate lives in `parseRecordLine` and the line-level atomicity in the `O_APPEND` write path, both covered by the package specs.
