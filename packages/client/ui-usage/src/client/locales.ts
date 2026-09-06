/** Typed locale dictionaries for the usage section; the key union drives `t`. */

export type UsageLocaleKey =
  | 'nav'
  | 'bubbleAria'
  | 'bubbleTotal'
  | 'close'
  | 'closeMark'
  | 'bubbleMark'
  | 'title'
  | 'intro'
  | 'refresh'
  | 'loadFailed'
  | 'retry'
  | 'empty'
  | 'totalsHeading'
  | 'requestsLabel'
  | 'inputLabel'
  | 'cacheReadLabel'
  | 'cacheWriteLabel'
  | 'outputLabel'
  | 'totalLabel'
  | 'todayHeading'
  | 'todayNone'
  | 'trendHeading'
  | 'range24h'
  | 'range7d'
  | 'range30d'
  | 'trendEmpty'
  | 'trendEmptyRange'
  | 'loading'
  | 'shareOfTotalTitle'
  | 'routesHeading'
  | 'routesEmpty'
  | 'routeNameColumn'
  | 'routeRequestsColumn'
  | 'routeTokensColumn'
  | 'routeShareColumn'
  | 'ledgerPathLabel'
  | 'moreRoutes'
  | 'sessionsHeading'
  | 'sessionsEmpty'
  | 'sessionColumn'
  | 'sessionRequestsColumn'
  | 'sessionTokensColumn'
  | 'sessionShareColumn'
  | 'sessionActivityColumn'
  | 'moreSessions'

/** The English dictionary; every key of the union resolves. */
export const en: Record<UsageLocaleKey, string> = {
  nav: 'Usage',
  bubbleAria: 'Token usage bubble',
  bubbleTotal: 'Total tokens',
  close: 'Close',
  closeMark: '\u00d7',
  bubbleMark: '\u03a3',
  title: 'Token usage',
  intro: 'Whole-deployment token accounting across every session, recorded in real time.',
  refresh: 'Refresh',
  loadFailed: 'Usage data is unavailable',
  retry: 'Retry',
  empty: 'No token usage recorded yet. Every model call from now on lands in the ledger.',
  totalsHeading: 'All time',
  requestsLabel: 'Requests',
  inputLabel: 'Input',
  cacheReadLabel: 'Cache read',
  cacheWriteLabel: 'Cache write',
  outputLabel: 'Output',
  totalLabel: 'Total',
  todayHeading: 'Today (UTC)',
  todayNone: 'No usage today yet.',
  trendHeading: 'Usage over time (UTC)',
  range24h: '24 hours',
  range7d: '7 days',
  range30d: '30 days',
  trendEmpty: 'Not enough history for a trend yet.',
  trendEmptyRange: 'No usage in this range — try another range.',
  loading: 'Loading…',
  shareOfTotalTitle: 'Share of all usage: {percent}%',
  routesHeading: 'By model',
  routesEmpty: 'No routes recorded.',
  routeNameColumn: 'Route',
  routeRequestsColumn: 'Requests',
  routeTokensColumn: 'Total tokens',
  routeShareColumn: 'Share of the largest route',
  ledgerPathLabel: 'Ledger file',
  moreRoutes: '{count} more routes',
  sessionsHeading: 'By session',
  sessionsEmpty: 'No sessions recorded.',
  sessionColumn: 'Session',
  sessionRequestsColumn: 'Requests',
  sessionTokensColumn: 'Total tokens',
  sessionShareColumn: 'Share of the largest session',
  sessionActivityColumn: 'Last activity',
  moreSessions: '{count} more sessions',
}

/** The Chinese dictionary, kept in lockstep with the English one. */
export const zh: Record<UsageLocaleKey, string> = {
  nav: '用量统计',
  bubbleAria: 'Token 用量气泡',
  bubbleTotal: '总 tokens',
  close: '关闭',
  closeMark: '\u00d7',
  bubbleMark: '\u03a3',
  title: 'Token 用量',
  intro: '跨所有会话、实时记录的整个部署 token 计量。',
  refresh: '刷新',
  loadFailed: '用量数据不可用',
  retry: '重试',
  empty: '还没有 token 用量记录。从现在起每次模型调用都会写入账本。',
  totalsHeading: '累计',
  requestsLabel: '请求数',
  inputLabel: '输入',
  cacheReadLabel: '缓存读',
  cacheWriteLabel: '缓存写',
  outputLabel: '输出',
  totalLabel: '总量',
  todayHeading: '今日（UTC）',
  todayNone: '今天还没有用量。',
  trendHeading: '用量走势（UTC）',
  range24h: '24 小时',
  range7d: '7 天',
  range30d: '30 天',
  trendEmpty: '历史还不足以为你画出走势。',
  trendEmptyRange: '这个区间没有用量——试试其他区间。',
  loading: '加载中…',
  shareOfTotalTitle: '占全部用量的 {percent}%',
  routesHeading: '按模型',
  routesEmpty: '暂无路由记录。',
  routeNameColumn: '路由',
  routeRequestsColumn: '请求数',
  routeTokensColumn: '总 tokens',
  routeShareColumn: '占最大路由的比例',
  ledgerPathLabel: '账本文件',
  moreRoutes: '还有 {count} 条路由',
  sessionsHeading: '按会话',
  sessionsEmpty: '暂无会话记录。',
  sessionColumn: '会话',
  sessionRequestsColumn: '请求数',
  sessionTokensColumn: '总 tokens',
  sessionShareColumn: '占最大会话的比例',
  sessionActivityColumn: '最近活动',
  moreSessions: '还有 {count} 个会话',
}
