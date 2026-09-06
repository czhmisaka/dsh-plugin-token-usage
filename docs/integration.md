# 集成指南 / Integration

把这两个包装回一个 deepseek-harness 检出（或在检出内直接开发）的完整步骤。以下命令假定：

- 已克隆 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（记为 `$HARNESS`），并跑过 `pnpm install`
- 本仓库克隆为 `$PLUGIN`
- Node ^22.19 || >=24，pnpm

## 1. 放置包源码（overlay）

两个包按工作区约定落位，`pnpm-workspace.yaml` 的 glob（`packages/*/*`）会自动收纳：

```sh
cp -R "$PLUGIN/packages/llm/usage-ledger"  "$HARNESS/packages/llm/usage-ledger"
cp -R "$PLUGIN/packages/client/ui-usage"   "$HARNESS/packages/client/ui-usage"
```

> 若目标检出已有同名目录，先确认差异再覆盖。包的 `package.json` 声明了 peer/dev 依赖（cordis、dsh-llm、dsh-session 等），全部解析到工作区内部，无需额外安装源。

## 2. 主机侧注册（base bundle）

在 `$HARNESS/packages/bundle/base/cordis.patch.yml` 的插件清单中加入（随附的 base bundle 已含此行，可跳过）：

```yaml
- id: usage-ledger
  name: '@deepseek-ai/dsh-usage-ledger'
  config:
    path: !!js dshHomePath('usage', 'usage.jsonl')
```

并在 `$HARNESS/packages/bundle/base/package.json` 的 dependencies 中加入：

```json
"@deepseek-ai/dsh-usage-ledger": "workspace:^"
```

## 3. Web 侧注册（web-app bundle）

在 `$HARNESS/packages/bundle/web-app/cordis.patch.yml` 的客户端插件清单中加入（随附的 web-app bundle 已含此行，可跳过）：

```yaml
- id: ui-usage
  name: '@deepseek-ai/dsh-client-ui-usage'
```

并在 `$HARNESS/packages/bundle/web-app/package.json` 的 dependencies 中加入：

```json
"@deepseek-ai/dsh-client-ui-usage": "workspace:^"
```

## 4. Remote 类型装配（api-remotes）

`$HARNESS/packages/api/remotes/src/client/index.ts` 需要三处接线（随附的 remotes 包已含，可跳过）：

```ts
import usageLedgerRemote from '@deepseek-ai/dsh-usage-ledger/remote'
// 在 Remote 装配数组中加入 usageLedgerRemote（与 sessionRemote 等并列）
export type {} from '@deepseek-ai/dsh-usage-ledger/remote'
export type {
  UsageLedgerBucket,
  UsageLedgerDayTotals,
  UsageLedgerHourTotals,
  UsageLedgerModelTotals,
  UsageLedgerSessionTotals,
  UsageLedgerSnapshot,
  UsageLedgerTotals,
} from '@deepseek-ai/dsh-usage-ledger/types'
```

## 5. 安装、构建、验证

```sh
cd "$HARNESS"
pnpm install                     # 工作区链接 + typert 生成
pnpm --filter @deepseek-ai/dsh-usage-ledger run build
pnpm --filter @deepseek-ai/dsh-client-ui-usage run bundle
pnpm vitest run packages/llm/usage-ledger packages/client/ui-usage
```

重启 `dsh --profile web` 后：

- 设置面板出现 **Token 用量 / 用量统计** 页
- Shell 层出现可拖拽的 Σ 用量气泡
- 任意会话内 `/usage` 输出全量、今日、最近 24 小时、按模型、按会话汇总
- 账本落在 `~/.dsh/usage/usage.jsonl`（可用 base bundle 行的 `path` 重定向）

## 配置假设

包内的 `tsconfig.json`（extends `../../../tsconfig.base*.json`、references 指向 vendor 与兄弟包）与 `tsdown.config.ts`（`import { clientBundle } from '../tsdown.client.ts'`）都按 harness 工作区布局编写——放在第 1 步的目标路径上即自动解析，无需改动。这也意味着**本仓库根目录不可独立安装/构建**：仓库刻意不带 `pnpm-workspace.yaml`。

## CI

`.github/workflows/overlay-verify.yml` 在推送/PR 时自动完成第 1–5 步（锁定 harness 提交 + overlay + 聚焦测试），每周一凌晨定时重跑以捕捉 harness 演进带来的破坏；适配新版 harness 后更新其中的 `HARNESS_REF`。

## 测试基线

本仓库源码在以下状态验证通过：deepseek-harness `usage-dashboard` 分支 `252bd20956`；`pnpm run test:gui`（3928 通过）、两包 vitest（61 通过）、`pnpm run typecheck`（host + client 双面）全绿。
