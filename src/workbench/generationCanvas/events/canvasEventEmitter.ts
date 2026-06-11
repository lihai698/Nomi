// 画布事件发射器(harness S5-a 影子日志):action 内部"构造事件→缓冲→批量 append"。
// 影子语义:store 仍是运行真相,事件只旁路记账;CI 属性测试锁 replay(events)≡snapshot,
// 为 S5-b 翻正(日志为唯一真相)铺安全网。
// 纪律(总方案 §4.4):payload 在入口深拷贝成 plain JSON(禁 immer draft 引用)并 freeze;
// 50ms/20 条先到先 flush;bridge 缺失(测试/旧 preload)或 IO 失败一律静默——绝不影响画布。
import { getDesktopBridge } from '../../../desktop/bridge'

export type CanvasShadowEvent = {
  id: string
  source: 'user' | 'agent' | 'runtime'
  txnId: string
  type: string
  payload: Record<string, unknown>
}

const FLUSH_MS = 50
const FLUSH_COUNT = 20

let projectIdProvider: () => string | null = () => null
let buffer: CanvasShadowEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let testSink: ((events: readonly CanvasShadowEvent[]) => void) | null = null

/** NomiStudioApp 在 hydrate 时注入(flush 时刻取值,防切换期错绑——同 conversationPersistence 教训)。 */
export function setCanvasEventProjectIdProvider(provider: () => string | null): void {
  projectIdProvider = provider
}

/** 测试用:捕获发射的事件(属性测试的对账输入)。 */
export function setCanvasEventSinkForTests(sink: ((events: readonly CanvasShadowEvent[]) => void) | null): void {
  testSink = sink
}

const mintId = () => `evt_${crypto.randomUUID().slice(0, 12)}`

function flushNow(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (buffer.length === 0) return
  const batch = buffer
  buffer = []
  const projectId = projectIdProvider()
  const api = getDesktopBridge()?.events
  if (!projectId || !api) return
  void api.append(projectId, batch).catch(() => {})
}

/**
 * 一次用户手势 = 一个 txnId(undo 的最小单位,§1.1)。
 * 一个 action 调用产生的全部事件经一次 emitCanvasGesture 发出,共享 txnId。
 */
export function emitCanvasGesture(
  events: readonly { type: string; payload: Record<string, unknown> }[],
  opts: { source?: 'user' | 'agent' | 'runtime'; txnId?: string } = {},
): void {
  if (events.length === 0) return
  const txnId = opts.txnId ?? `txn_${crypto.randomUUID().slice(0, 10)}`
  const out = events.map((event) =>
    Object.freeze({
      id: mintId(),
      source: opts.source ?? 'user',
      txnId,
      type: event.type,
      // 深拷贝成 plain JSON:杜绝 immer draft/共享引用混进日志(§4.4 纪律)。
      payload: JSON.parse(JSON.stringify(event.payload)) as Record<string, unknown>,
    }),
  )
  testSink?.(out)
  buffer.push(...out)
  if (buffer.length >= FLUSH_COUNT) flushNow()
  else if (!timer) timer = setTimeout(flushNow, FLUSH_MS)
}
