// 批量执行计划预览态(harness S2b,样张方案 A:画布原位确认)。
// 语义铁律:进入预览 ≠ 开始生成——确认前零 vendor 调用零扣费;取消即散,画布零变化。
import { create } from 'zustand'
import { toast } from '../../../ui/toast'
import { runGenerationNodesByPlan } from '../runner/generationRunController'
import type { DependencyWavePlan } from '../runner/dependencyWaves'

type BatchPlanPreviewState = {
  plan: DependencyWavePlan | null
  running: boolean
  open: (plan: DependencyWavePlan) => void
  cancel: () => void
  confirm: () => Promise<void>
}

export const useBatchPlanPreviewStore = create<BatchPlanPreviewState>()((set, get) => ({
  plan: null,
  running: false,
  open: (plan) => set({ plan, running: false }),
  cancel: () => set({ plan: null, running: false }),
  confirm: async () => {
    const { plan, running } = get()
    if (!plan || running) return
    set({ running: true })
    set({ plan: null, running: false })
    await runPlanWithToasts(plan)
  },
}))

/**
 * 被拦下的节点(上游参考没生成 / 循环) → 人话提示文案；无 blocked 返回 null。
 * 「缺啥提示啥」：不再把 blocked 算进总数静默丢，而是明确告诉用户哪些没跑、为什么、怎么办。
 */
export function describeBlockedNotice(plan: DependencyWavePlan): string | null {
  if (plan.blocked.length === 0) return null
  const cycle = plan.blocked.filter((b) => b.reason === 'cycle').length
  const waiting = plan.blocked.length - cycle
  const parts: string[] = []
  if (waiting > 0) parts.push(`${waiting} 个在等上游参考（参考卡）先生成`)
  if (cycle > 0) parts.push(`${cycle} 个存在循环引用`)
  return `还有 ${parts.join('、')}——先把它们生成/理顺，再批量。`
}

/** 按计划真实生成 + 进度人话 toast。「全部生成」与 S6b agent 受理路径共用(单一执行口)。 */
export async function runPlanWithToasts(plan: DependencyWavePlan): Promise<void> {
  const runnable = plan.waves.flat().length
  const notice = describeBlockedNotice(plan)
  if (runnable === 0) {
    // 全被拦：别静默，说清原因
    toast(notice ? `还不能生成：${notice}` : '没有可生成的节点', 'error')
    return
  }
  toast(`开始生成 ${runnable} 个节点(${plan.waves.length} 波)…`, 'info')
  try {
    const result = await runGenerationNodesByPlan(plan)
    const okCount = result.successes.length
    const failCount = result.failures.length
    if (failCount === 0) toast(`已完成 ${okCount}/${runnable} 个节点的生成`, 'success')
    else if (okCount === 0) toast(`批量生成失败：${failCount}/${runnable} 个节点未完成`, 'error')
    else toast(`已完成 ${okCount}/${runnable}，${failCount} 个失败 — 在画布上单独重试`, 'info')
  } catch (error: unknown) {
    toast(error instanceof Error && error.message ? error.message : '批量生成异常', 'error')
  }
  // 跑完再把「没跑的为什么」补一条(缺啥提示啥)
  if (notice) toast(notice, 'info')
}
