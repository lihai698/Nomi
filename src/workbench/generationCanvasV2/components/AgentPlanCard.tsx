import React from 'react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import { summarizeAgentPlan, type AgentPlanSummary } from './agentPlanSummary'

export { summarizeAgentPlan }

export type PendingToolCall = {
  toolCallId: string
  toolName: string
  args: unknown
  confirm: (decision: { ok: true; result?: unknown } | { ok: false; message?: string }) => Promise<void>
}

type AgentPlanCardProps = {
  plan: AgentPlanSummary
  /** Resolve a single tool call with the given decision (used internally). */
  resolveCall: (
    toolCallId: string,
    decision: { ok: true; result?: unknown } | { ok: false; message?: string },
    overrides?: Record<string, unknown>,
  ) => void
}

/**
 * Aggregated "plan" preview card. When the agent has queued up
 * `create_canvas_nodes` (plus optionally `connect_canvas_edges`), we
 * collapse the two calls into a single confirmable card that previews
 * each node, lets the user tweak prompts in-place, and resolves the
 * whole batch with one click.
 */
export default function AgentPlanCard({ plan, resolveCall }: AgentPlanCardProps): JSX.Element {
  const [editedPrompts, setEditedPrompts] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    plan.nodes.forEach((node) => { initial[node.clientId] = node.prompt })
    return initial
  })
  const [expandedNodeId, setExpandedNodeId] = React.useState<string | null>(null)

  const handleConfirmAll = React.useCallback(() => {
    // Apply user-edited prompts before forwarding the create_canvas_nodes
    // call to the renderer-side executor.
    const patchedNodes = plan.nodes.map((node) => ({
      clientId: node.clientId,
      kind: node.kind,
      title: node.title,
      prompt: editedPrompts[node.clientId] ?? node.prompt,
      ...(node.position ? { position: node.position } : {}),
    }))
    resolveCall(
      plan.createCallId,
      { ok: true, result: { confirmed: true } },
      { nodes: patchedNodes, summary: plan.summary },
    )
    if (plan.connectCallId) {
      resolveCall(
        plan.connectCallId,
        { ok: true, result: { confirmed: true } },
      )
    }
  }, [editedPrompts, plan, resolveCall])

  const handleRejectAll = React.useCallback(() => {
    resolveCall(plan.createCallId, { ok: false, message: 'rejected by user' })
    if (plan.connectCallId) {
      resolveCall(plan.connectCallId, { ok: false, message: 'rejected by user' })
    }
  }, [plan, resolveCall])

  return (
    <div
      className={cn(
        'flex flex-col gap-3 p-3 rounded-nomi border border-nomi-accent-soft bg-nomi-accent-soft/40',
      )}
      data-agent-plan-card="true"
      aria-label="Agent 故事板计划卡片"
    >
      <div className={cn('flex items-center justify-between gap-2')}>
        <div className={cn('flex flex-col gap-[2px]')}>
          <div className={cn('text-nomi-accent text-[11.5px] font-medium uppercase tracking-wider')}>
            Agent 故事板计划
          </div>
          <div className={cn('text-nomi-ink text-[13.5px] font-medium leading-snug')}>
            {plan.summary}
          </div>
          <div className={cn('text-nomi-ink-60 text-[11.5px]')}>
            {plan.nodes.length} 个节点 · {plan.edges.length} 条引用边
          </div>
        </div>
      </div>

      <ol
        className={cn('flex flex-col gap-2 list-none p-0 m-0')}
        aria-label="待确认的镜头列表"
      >
        {plan.nodes.map((node, index) => {
          const isExpanded = expandedNodeId === node.clientId
          const currentPrompt = editedPrompts[node.clientId] ?? node.prompt
          return (
            <li
              key={node.clientId}
              className={cn(
                'flex flex-col gap-[6px] p-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line-soft',
              )}
              data-plan-node-id={node.clientId}
            >
              <div className={cn('flex items-center justify-between gap-2')}>
                <div className={cn('flex items-center gap-2 min-w-0')}>
                  <span className={cn(
                    'inline-grid place-items-center w-5 h-5 rounded-full bg-nomi-ink text-nomi-paper text-[11px] font-medium shrink-0',
                  )}>{index + 1}</span>
                  <span className={cn('text-nomi-ink text-[12.5px] font-medium truncate')}>{node.title}</span>
                </div>
                <button
                  type="button"
                  className={cn(
                    'shrink-0 h-6 px-2 rounded-nomi-sm border border-transparent bg-transparent',
                    'text-nomi-ink-60 text-[11.5px] cursor-pointer',
                    'hover:bg-nomi-ink-05 hover:text-nomi-ink',
                  )}
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedNodeId(isExpanded ? null : node.clientId)}
                >
                  {isExpanded ? '收起' : '编辑'}
                </button>
              </div>
              <div className={cn('text-nomi-ink-60 text-[11.5px] line-clamp-2 break-words')}>
                {currentPrompt || '(无 prompt)'}
              </div>
              {isExpanded ? (
                <textarea
                  className={cn(
                    'w-full min-h-[60px] p-2 rounded-nomi-sm border border-nomi-line-soft',
                    'bg-nomi-ink-05 text-nomi-ink text-[12px] leading-[1.5] resize-y outline-0',
                  )}
                  aria-label={`编辑第 ${index + 1} 个镜头的提示词`}
                  value={currentPrompt}
                  onChange={(event) => setEditedPrompts((current) => ({
                    ...current,
                    [node.clientId]: event.target.value,
                  }))}
                />
              ) : null}
            </li>
          )
        })}
      </ol>

      <div className={cn('flex items-center justify-end gap-2')}>
        <WorkbenchButton
          className={cn(
            'h-8 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-[12.5px] cursor-pointer',
            'hover:bg-nomi-ink-05',
          )}
          onClick={handleRejectAll}
        >
          全部拒绝
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'h-8 px-3 rounded-nomi-sm border-0 bg-nomi-ink text-nomi-paper text-[12.5px] font-medium cursor-pointer',
            'hover:bg-nomi-accent',
          )}
          data-plan-confirm-all="true"
          onClick={handleConfirmAll}
        >
          确认全部 ({plan.nodes.length} 节点)
        </WorkbenchButton>
      </div>
    </div>
  )
}
