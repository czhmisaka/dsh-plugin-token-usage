---
description: "面向用户与维护者的 Web 用量面板说明:在设置面板中读取整个部署的 token 计量数据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-usage

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-client-ui-usage` 是 token 用量账本的浏览器端:它注册设置面板中的 **用量统计** 页,并从 `ctx.remote.usage.totals()` 渲染整个部署的仪表盘——累计数字、当日合计、按时间的用量走势图、按路由明细表、按会话明细表。页面在挂载时和用户点击刷新时取数;账本随每次模型调用变化,刷新按钮就是货币性(新鲜度)操作。它不拥有任何设置文档、不写入任何内容、不增加任何模型可见面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 组合中把本插件挂在设置外壳与 Remote 程序集旁;随附的 `dsh-web-app` bundle 已挂载。组合完成后,设置面板导航中即出现该页;宿主未提供 `usage` 命名空间时(未组合 `dsh-usage-ledger` 的组合)不渲染任何内容。

### 组合

```yaml
- name: '@deepseek-ai/dsh-client-ui-usage'
```

### 仪表盘渲染什么

- **累计** — 请求数与四个互斥 token 桶加计费总量,紧凑人性化格式。
- **今日(UTC)** — 今天的请求数与总量,或无用量提示。
- **用量走势** — 日历对齐的面积图,可切换 24 小时 / 7 天 / 30 天区间:近一天按小时分桶,更早按日汇总;无用量的桶按零绘制,横轴始终止于当前小时或今天(UTC)。
- **按模型** — 前八条路由的请求数与总量,其余以条数汇总。
- **按会话** — 前十个会话的请求数、总量与各自最近活动日(UTC),其余以条数汇总;行的悬停标题展示完整会话 id。
- **账本文件** — 符号化的账本位置(`~/.dsh/...` 或 `$DSH_HOME/...`)。

Remote 调用失败时渲染失败码与刷新操作;本地故障按 Remote 纪律继续崩溃。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 注册词典与携带 load face 的 `settings.section` 条目 |
| [`src/client/usage-section.tsx`](src/client/usage-section.tsx) | 页面组件:取数状态、数字网格、时间走势图、路由与会话表 |
| [`src/client/shaping.ts`](src/client/shaping.ts) | 纯快照到视图的塑形:紧凑计数、每日走势序列、路由与会话封顶 |
| [`src/client/locales.ts`](src/client/locales.ts) | 类型化的中英词典 |

### 数据流

注入面暴露一个闭包 over `ctx.remote.usage.totals()` 的 `load` 回调。组件在本地持有取数状态(loading / failed / ready),在 ready 态用一次 `shapeDashboard` 派生整个视图,只通过用户的刷新重新取数。没有订阅:账本随每次模型调用变化,实时更新的计数器会在无关流量上反复重渲染面板。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### token 与 KV Cache 影响

#### 模型看到什么

什么都不看到。页面读取一个 Remote 端点并渲染 HTML;不贡献任何提示段、工具、消息或会话事件。

#### token 影响

仪表盘不发起任何模型请求。它渲染的每个数字都镜像适配器已上报、账本已记录的 `TokenUsage`。

#### KV Cache 影响

无影响。页面不贡献请求内容,缓存身份不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义仪表盘的边界与未来工作的起点。它们是当前包约束,不是展示方式的比较或任务清单。

- **无实时更新** — 页面在挂载与刷新时取数;实时计数器延期到有消费方需要时再做,因为账本随每次模型调用变化。
- **时间分辨率是 UTC 桶** — 7/30 天视图按 UTC 日历日折叠,24 小时视图按 UTC 小时折叠;账本只保留最近 48 小时的小时桶,更早的小时级历史不留存。
- **路由表封顶八行** — 其余以条数呈现;按路由的分页属于更完整的浏览器面。
- **会话行展示 id 而非标题** — 账本只记录会话 id,表格标签取 id 前缀、悬停标题展示完整 id;人类可读的会话标题属于更丰富的查询面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

此开发备注为非权威工作语境:维护者备注与开放问题。已交付行为与已接受的理由见上文各节、包代码与链接的 Agent Note。

- 紧凑数字格式刻意与区域无关,与 `/usage` 命令文本一致,两个口径读起来一样;区域感知的格式化器会让两处不一致。
- 没有 `./invariant` 伴随包:页面渲染一次经纯折叠的 Remote 读取,展示关系(数字合计、趋势缩放)由包规格覆盖。

</details>
