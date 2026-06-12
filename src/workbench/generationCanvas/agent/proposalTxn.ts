// 提议事务执行器(harness S6-2)——状态机 approved→committed/aborted 的落地层。
// 一笔提议(plan card 的 create+connect 折叠,或单工具)= 一个 proposalId = 一次原子批量:
// 全成 → agent.txn.committed;中途失败 → 补偿回滚(删已建节点)+ agent.txn.aborted,零半截(I3)。
// 事务包裹在 applyCanvasToolCall 外面(它仍是工具→变更的单一真相源,§8.1b 不动项)。
// 撤销粒度:整笔提议打一个 barrier(批准是一次用户意志,§6.2);abort 时拔掉事务内 barrier,
// Cmd+Z 永远撤不出半截态。
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { generationCanvasTools } from './generationCanvasTools'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { withCanvasGestureContext, type CanvasGestureContext } from '../events/canvasGestureContext'
import {
  dropUndoBarriersAfter,
  getUndoJournalPosition,
  pushUndoSnapshot,
} from '../events/canvasUndoJournal'

export type ProposalStep = {
  toolCallId: string
  toolName: string
  effectiveArgs: Record<string, unknown>
}

export type ProposalOutcome =
  | { status: 'committed'; proposalId: string; results: unknown[]; clientIdToNodeId: Record<string, string> }
  | { status: 'aborted'; proposalId: string; failedIndex: number; reason: string; compensatedNodeIds: string[] }

export function mintProposalId(): string {
  return `prop_${crypto.randomUUID().slice(0, 10)}`
}

/**
 * 原子应用一笔提议的全部步骤。调用方(确认面板/auto 路径)拿 outcome 后再逐步 resolve
 * LLM 的 confirm——先落地后回话,LLM 看到的成败与画布事实一致。
 * 补偿边界:目前唯一的多步形态是 create→connect,connect 端点校验在前(skip 不抛)、
 * 唯一可补偿副作用是已建节点;删节点连带删其边,故"删已建节点"即完整补偿。
 */
export async function applyProposalBatch(steps: ProposalStep[]): Promise<ProposalOutcome> {
  const proposalId = mintProposalId()
  const ctx: CanvasGestureContext = {
    source: 'agent',
    txnId: `txn_${proposalId}`,
    proposalId,
    suppressUndoBarriers: true,
  }
  const journalStart = getUndoJournalPosition()
  // 事务自己的 barrier(在上下文外打,不被抑制):commit 后一次 Cmd+Z 撤整笔。
  pushUndoSnapshot()

  const createdNodeIds: string[] = []
  const clientIdToNodeId: Record<string, string> = {}
  const results: unknown[] = []

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    try {
      const result = await applyCanvasToolCall(step.toolName, step.effectiveArgs, ctx)
      if (step.toolName === 'create_canvas_nodes' && result && typeof result === 'object') {
        const record = result as { createdNodeIds?: unknown; clientIdToNodeId?: Record<string, string> }
        if (Array.isArray(record.createdNodeIds)) {
          createdNodeIds.push(...record.createdNodeIds.filter((id): id is string => typeof id === 'string'))
        }
        Object.assign(clientIdToNodeId, record.clientIdToNodeId ?? {})
      }
      results.push(result)
    } catch (error: unknown) {
      const reason = error instanceof Error && error.message ? error.message : String(error)
      // 补偿回滚:删掉本事务已建节点(连带其边),画布回到提议前投影(I3)。
      const compensatedNodeIds = createdNodeIds.length
        ? withCanvasGestureContext(ctx, () => generationCanvasTools.delete_nodes(createdNodeIds))
        : []
      // 拔掉指向事务中段的 barrier(含事务自己那个)——净零事件留在 journal 无害(前缀重放
      // 容忍),但 Cmd+Z 不许停在半截态上。
      dropUndoBarriersAfter(journalStart)
      withCanvasGestureContext(ctx, () =>
        emitCanvasGesture([
          {
            type: 'agent.txn.aborted',
            payload: {
              proposalId,
              reason,
              failedToolCallId: step.toolCallId,
              failedToolName: step.toolName,
              failedIndex: index,
              stepCount: steps.length,
              compensatedNodeIds,
            },
          },
        ]),
      )
      return { status: 'aborted', proposalId, failedIndex: index, reason, compensatedNodeIds }
    }
  }

  withCanvasGestureContext(ctx, () =>
    emitCanvasGesture([
      {
        type: 'agent.txn.committed',
        payload: {
          proposalId,
          steps: steps.map((step) => ({ toolCallId: step.toolCallId, toolName: step.toolName })),
          ...(Object.keys(clientIdToNodeId).length ? { clientIdToNodeId } : {}),
        },
      },
    ]),
  )
  return { status: 'committed', proposalId, results, clientIdToNodeId }
}
