# dsh-plugin-Token 统计

[English](#english) | 中文

DeepSeek Harness 的 **Token 用量统计插件**——跨会话、实时的整部署 token 计量与可视化面板。本仓库从 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 工作区中抽离了该插件的全部源码，供独立浏览、审阅与集成。

## 功能总览

- **持久账本**（`packages/llm/usage-ledger`）：每条计费模型调用实时追加为 JSONL 记录（会话 id、路由、四个互斥 token 桶），跨会话、跨进程、抗崩溃；`ctx.usageLedger.totals()` 一次折叠出全量/按路由/按 UTC 日/按 UTC 小时（最近 48 小时）/按会话的合计，并注册 `/usage` 命令。
- **用量气泡**（`packages/client/ui-usage`）：Shell 层可拖拽悬浮气泡，显示压缩总量，点击展开摘要面板，60 秒慢定时刷新。
- **设置面板仪表盘**：六宫格指标（彩色圆点 + 构成条展示 token 构成）、今日（UTC）、**24 小时 / 7 天 / 30 天**三档用量走势面积图（小时/日分桶、峰值标记、半值参考线、悬停精确值）、按模型表与按会话表（占比条 + 精确悬停）。
- 双语界面（中/英），全部走类型化词典；所有颜色来自主题语义 token，自动适配深浅色。

## 仓库结构

```
packages/llm/usage-ledger/   主机侧插件（Cordis 服务类 + /usage 命令 + 折叠器）
packages/client/ui-usage/    浏览器侧插件（设置面板仪表盘 + Shell 气泡）
docs/integration.md          集成到 deepseek-harness 检出的精确步骤
```

## 使用方式

这两个包是 deepseek-harness 工作区插件，依赖 cordis 运行时、typert 生成器与若干 `@deepseek-ai/dsh-*` 内部包，**在 harness 检出内构建**。步骤见 [docs/integration.md](docs/integration.md)。

本仓库代码提取自 deepseek-harness（MIT）`usage-dashboard` 分支，对应提交 `252bd20956`。在此之上的修改同样以 MIT 发布。

## English

Token usage statistics plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a durable cross-session JSONL ledger (host plugin with a fold service and the /usage command) plus a web dashboard (settings section + draggable shell bubble) with hourly/daily usage charts, per-route and per-session tables, and a token-composition bar. The two packages build inside a deepseek-harness checkout — see [docs/integration.md](docs/integration.md). Extracted from the `usage-dashboard` branch at commit `252bd20956`; MIT licensed.
