---
description: "面向用户与维护者的用量台账说明：实时记录并展示整个部署的 token 使用总量。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-ledger

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-usage-ledger` 记录整个 harness 部署的每一次计费模型调用：每条带用量上报的 `assistant/message` 事件在提交的瞬间就会作为一行 JSON 追加进 harness home 下的只追加账本文件，`ctx.usageLedger` 再把文件折叠成整本账的总量——全量、按路由、按 UTC 日期、按 UTC 小时（最近 48 小时窗口）、按会话——并通过 `/usage` 命令展示。这份账本跨会话持久：翻页、压缩、会话删除与进程重启都不影响它，也与 `dsh-token-meter` 提供的按会话 `tokenUsage` 投影相互独立。它自身不添加任何提示词、消息、schema 或工具。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在会话存储旁挂载本插件，部署就会保留一份 token 总用量的持久记录。随附的 `dsh-base` bundle 以 `dshHomePath('usage', 'usage.jsonl')` 挂载它，因此所有基于 base 的 profile 默认都在记录；部署可通过该行的 `path` 配置重定向文件。

### 组合

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-usage-ledger'
  config:
    path: !!js dshHomePath('usage', 'usage.jsonl')
```

`path` 必填，波浪号展开（`~/...`）后必须是绝对路径。已存在的目标必须是普通文件；父目录在加载时按需创建。相对路径、目录目标、或位于普通文件之下的目标都会在加载时大声失败。

### 账本记录什么

每条带 token 统计的 `assistant/message` 事件产生一条记录：追加时间、会话 id、来自消息 source 的 provider 与 model，以及四个互斥的 token 桶（`inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`）。被打断的消息也计入——已交付的前缀同样计费。没有用量上报的消息、以及其余所有事件类型都不产生记录。重试只计一次：只有组装出最终消息的那次尝试会在持久日志里携带用量。

### 实时与持久

追加链在事件提交的那一刻启动，文件在毫秒级反映出每次调用。被等待的 `session/flush` 持久检查点会排空写入链，因此账本丢掉的记录恰好等于崩溃时 session log 自身丢失的记录。直接读文件的使用方可以先 await `ctx.usageLedger.flush()`。卸载（disposal）会先排空挂起的记录再关闭文件。

### 读取总量

`ctx.usageLedger.totals()` 返回深度冻结的快照：全量合计、按总 token 降序的路由明细、按 UTC 日升序的日合计、最近 48 小时内按 UTC 小时升序的小时合计、按总 token 降序且附带各自最新记录时间的会话明细，以及最新记录时间。当文件的大小或 mtime 越过缓存折叠点——包括共享同一 harness home 的其他进程的追加——折叠会重读文件，否则直接返回缓存快照。

### /usage 命令

组合中存在命令注册表时，插件注册全局 `/usage` 命令，渲染全量数字、当日（UTC）数字、最近 24 小时汇总、前五个路由以及前五个会话及其最近活动日；空账本则渲染指向账本文件的提示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释执行器背后的设计；可观察行为已完全覆盖在[使用本包](#use-this-package)。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务类插件：firehose 监听、串行追加链、总量折叠、/usage 命令 |
| [`src/records.ts`](src/records.ts) | 记录行编码与行级校验 |
| [`src/fold.ts`](src/fold.ts) | 纯记录到总量的折叠 |
| [`src/display.ts`](src/display.ts) | 命令文本渲染与符号化路径显示 |
| [`src/types.ts`](src/types.ts) | 记录与总量词汇表 |

### 写路径

`session/event` 是提交后的 firehose，记录塑形必须保持同步：监听器把事件折成记录，再把一次 `write()` 串到序列化的 promise 链上。链保持提交顺序，写入失败只记日志、绝不抛出，文件句柄在首次追加时惰性打开。多个 profile 共享一个 harness home 时记录也能安全交错：每行都是一次原子的 `O_APPEND` 写入。

### 读路径

总量折叠用流式逐行读取账本，跳过无法通过校验的行——崩溃写手留下的残尾行只跳过它自己。桶合计按 `input + cacheRead + cacheWrite + output` 推导，与 `dsh-token-meter` 折叠的计费总量约定一致。

### 这本账不是什么

它不是按会话的状态：投影折叠单个会话的日志，而这份账本跨进程观察到的所有会话（包括 subagent 与 workflow 子会话）累积。种子事件不经过 firehose，因此 resume 与 fork 绝不重复计数。它也不是脱敏或披露面——记录不携带任何消息内容，只有计数与路由。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Token meter](../token-meter/README.zh.md) — 按会话的重放感知测量服务与其 `tokenUsage` 投影。
- [Session stats](../../session/session-stats/README.zh.md) — 按会话的对话数字投影。
- [会话持久化子系统](../../../docs/subsystems/persistence.zh.md) — 本账本对齐的 flush 检查点语义。
- [Home 路径](../../util/home-paths/README.zh.md) — `dshHomePath` 如何解析账本根目录。

-----

<a id="model-experience"></a>
## 模型体验

### token 与 KV Cache 影响

#### 模型看到什么

什么都不看到。账本只监听事件流、写自己的文件、在 `ctx.usageLedger` 上注册 `/usage` 人用命令；没有提示段、工具 schema、消息或上下文注入。

#### token 影响

账本不发起任何模型请求。每条 `TokenUsage` 记录镜像适配器已上报的单条消息用量；其总量等于该部署的提供方计费口径。

#### KV Cache 影响

无影响。账本不贡献请求内容，缓存身份不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义账本的边界与未来工作的起点。它们是当前包约束，不是记账方法的比较或任务清单。

- **总量是追加时的事实** — 账本记录持久日志对每次尝试上报的用量；提供方侧的账单调整、以及未上报用量的失败尝试对它不可见。
- **按天分桶使用 UTC** — 持久日期键取记录时间的 UTC 日历日；本地时区视图属于展示层。
- **totals() 是折叠时快照** — 折叠期间其他进程追加的记录要到下一次调用观察到文件变化后才会体现。
- **尚无查询 API** — 服务只暴露整本账合计（含固定的按会话拆分）；时间窗或带筛选条件的拆分需要直接读 JSONL 文件，直到出现查询面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

此开发备注为非权威工作语境：维护者备注与开放问题。已交付行为与已接受的理由见上文各节、包代码与链接的 Agent Note。

- 记录 schema 带 version 戳（`version: 1`），未来布局演进时递增该字段即可；折叠跳过无法校验的记录而不是让启动失败。
- 没有 `./invariant` 伴随包：账本拥有的关系只能通过服务自身读取的同一份文件观察，见下方运行时不变式声明。

</details>

**运行时不变式：** 不发布伴随包。账本拥有的关系（每条计费 `assistant/message` 事件一条记录、总量等于账本文件的折叠结果）只能通过本服务写入并读取的同一份只追加文件观察，不存在可发散的独立观察；记录 schema 闸门在 `parseRecordLine`，行级原子性在 `O_APPEND` 写路径，均由包规格覆盖。
