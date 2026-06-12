// 生成画布 AI 对话的 per-project 桶交换(harness S1,治串台)。
// 外挂模块而非 store action:generationCanvasStore 是白名单巨壳(基线只减不增,R12),
// 不往里喂;用 zustand 外部 setState 实现同等语义。
import { createConversationBuckets } from '../../aiConversationBuckets'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import { useGenerationCanvasStore } from './generationCanvasStore'
import { clearCommittedProposal } from '../agent/proposalUndo'

const generationAiBuckets = createConversationBuckets(() => ({
  generationAiDraft: '',
  generationAiMessages: [] as WorkbenchAiMessage[],
}))

/** 切项目:存旧项目的画布助手对话,载入新项目的(没有则空)。 */
export function swapGenerationAiProject(prevId: string | null, nextId: string | null): void {
  // S6-5 约束③:整笔撤销入口不跨项目——补偿计划引用的是旧项目节点,跨项目执行会复活幽灵。
  clearCommittedProposal()
  const state = useGenerationCanvasStore.getState()
  useGenerationCanvasStore.setState(
    generationAiBuckets.swap(prevId, nextId, {
      generationAiDraft: state.generationAiDraft,
      generationAiMessages: state.generationAiMessages,
    }),
  )
}
