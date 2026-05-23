import { IconSend2, IconX } from '@tabler/icons-react'
import { NomiAILabel, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import React from 'react'
import { cn } from '../../../utils/cn'
import { buildPlannedEdges, toCreateNodeInputs } from '../agent/generationCanvasAgentPlan'
import { sendGenerationCanvasAgentMessage } from '../agent/generationCanvasAgentClient'
import { generationCanvasTools } from '../agent/generationCanvasTools'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { AiReplyActionButton } from '../../ai/AiReplyActionButton'
import { handleAiComposerKeyDown } from '../../ai/aiComposerKeyboard'
import { openWorkbenchModelIntegration, WorkbenchAiHeaderActions } from '../../ai/WorkbenchAiHeaderActions'

type PendingToolCall = {
  toolCallId: string
  toolName: string
  args: unknown
  confirm: (decision: { ok: true; result?: unknown } | { ok: false; message?: string }) => Promise<void>
}

function summarizeToolCall(toolName: string, args: unknown): string {
  const record = (args && typeof args === 'object') ? args as Record<string, unknown> : {}
  if (toolName === 'create_canvas_nodes') {
    const nodes = Array.isArray(record.nodes) ? record.nodes : []
    const summary = typeof record.summary === 'string' ? record.summary : ''
    return `创建 ${nodes.length} 个节点${summary ? `：${summary}` : ''}`
  }
  if (toolName === 'connect_canvas_edges') {
    const edges = Array.isArray(record.edges) ? record.edges : []
    return `连接 ${edges.length} 条边`
  }
  if (toolName === 'set_node_prompt') {
    return `改写节点 ${String(record.nodeId || '')} 的提示词`
  }
  if (toolName === 'delete_canvas_nodes') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return `删除 ${ids.length} 个节点`
  }
  if (toolName === 'read_canvas_state') {
    return '读取画布当前状态'
  }
  return `${toolName}`
}

type CanvasAssistantPanelProps = {
  defaultCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

function createMessageId(): string {
  return `assistant-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function CanvasAssistantPanel({
  defaultCollapsed = false,
  onCollapsedChange,
}: CanvasAssistantPanelProps): JSX.Element {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const snapshot = React.useMemo(() => generationCanvasTools.read_canvas(), [nodes, edges, selectedNodeIds])
  const selectedNodes = React.useMemo(() => generationCanvasTools.read_selected_nodes(), [nodes, selectedNodeIds])
  const [busy, setBusy] = React.useState(false)
  const [mode, setMode] = React.useState<'agent' | 'chat' | 'refine'>('agent')
  const [pendingToolCalls, setPendingToolCalls] = React.useState<PendingToolCall[]>([])

  const resolvePending = React.useCallback((toolCallId: string, decision: { ok: true; result?: unknown } | { ok: false; message?: string }) => {
    setPendingToolCalls((current) => {
      const target = current.find((item) => item.toolCallId === toolCallId)
      if (target) void target.confirm(decision)
      return current.filter((item) => item.toolCallId !== toolCallId)
    })
  }, [])

  // Exposed for the V2 agent client (wired in B6) so the panel can render
  // pending tool calls and forward the user's confirmation back to the IPC
  // session. We surface it via a ref so the call site doesn't have to
  // re-render on every state change.
  const pendingToolCallsRef = React.useRef({
    enqueue: (call: PendingToolCall) => setPendingToolCalls((current) => [...current, call]),
    clear: () => setPendingToolCalls([]),
  })
  const draft = useGenerationCanvasStore((state) => state.generationAiDraft)
  const messages = useGenerationCanvasStore((state) => state.generationAiMessages)
  const collapsed = useGenerationCanvasStore((state) => state.generationAiCollapsed)
  const setDraft = useGenerationCanvasStore((state) => state.setGenerationAiDraft)
  const setMessages = useGenerationCanvasStore((state) => state.setGenerationAiMessages)
  const setCollapsed = useGenerationCanvasStore((state) => state.setGenerationAiCollapsed)
  const resetConversation = useGenerationCanvasStore((state) => state.resetGenerationAiConversation)

  React.useEffect(() => {
    if (messages.length === 0 && !draft.trim()) setCollapsed(defaultCollapsed)
  }, [defaultCollapsed, draft, messages.length, setCollapsed])

  React.useEffect(() => {
    onCollapsedChange?.(collapsed)
  }, [collapsed, onCollapsedChange])

  const appendMessage = React.useCallback((message: { role: 'assistant' | 'user' | 'tool'; content: string }) => {
    setMessages((current) => [...current, { id: createMessageId(), ...message }])
  }, [setMessages])

  const updateMessage = React.useCallback((id: string, content: string) => {
    setMessages((current) => current.map((message) => (
      message.id === id ? { ...message, content } : message
    )))
  }, [setMessages])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    appendMessage({ role: 'user', content: text })
    const assistantMessageId = createMessageId()
    setMessages((current) => [
      ...current,
      { id: assistantMessageId, role: 'assistant', content: '处理中...' },
    ])
    setBusy(true)
    void (async () => {
      try {
        const result = await sendGenerationCanvasAgentMessage({
          message: text,
          snapshot,
          selectedNodes,
          mode,
          onContent: (_delta, streamedText) => {
            if (mode === 'chat') updateMessage(assistantMessageId, streamedText || '处理中...')
          },
        })

        if (mode === 'chat') {
          updateMessage(assistantMessageId, result.response.text || '已回答。')
          return
        }

        if (mode === 'refine') {
          const plan = result.plan
          if (plan?.nodes.length && selectedNodes.length > 0) {
            const firstNode = plan.nodes[0]
            if (firstNode?.prompt) {
              generationCanvasTools.update_node_prompt(selectedNodes[0].id, firstNode.prompt)
              updateMessage(assistantMessageId, '已更新选中节点的提示词。')
              return
            }
          }
          updateMessage(assistantMessageId, result.response.text || '润色完成。')
          return
        }

        if (!result.plan) {
          throw new Error('生成区 Agent 没有返回节点计划。')
        }
        const nodeInputs = toCreateNodeInputs(result.plan)
        const createdNodes = generationCanvasTools.create_nodes(nodeInputs)
        const edges = buildPlannedEdges(result.plan, createdNodes.map((node) => node.id))
        if (edges.length > 0) generationCanvasTools.connect_nodes(edges)
        updateMessage(
          assistantMessageId,
          `已创建 ${createdNodes.length} 个待确认节点${edges.length > 0 ? `，并连接 ${edges.length} 条关系` : ''}。你可以先检查提示词，再点击节点上的生成按钮。`,
        )
      } catch (error: unknown) {
        updateMessage(
          assistantMessageId,
          `生成区 Agent 执行失败：${error instanceof Error && error.message ? error.message : '未知错误'}`,
        )
      } finally {
        setBusy(false)
      }
    })()
  }

  const handleNewConversation = React.useCallback(() => {
    resetConversation()
  }, [resetConversation])

  if (collapsed) {
    return (
      <aside
        className={cn(
          'generation-canvas-v2-assistant',
          'block w-auto h-auto rounded-full',
        )}
        data-collapsed="true"
        aria-label="生成区 AI 启动器"
      >
        <WorkbenchButton
          className={cn(
            'generation-canvas-v2-assistant__launcher',
            'inline-flex items-center gap-2 h-9 pl-[10px] pr-[14px]',
            'border border-nomi-line rounded-full',
            'bg-nomi-paper text-nomi-ink font-[inherit] text-[13px] font-medium',
            'shadow-nomi-sm cursor-pointer',
            'hover:shadow-nomi-md hover:-translate-y-px',
          )}
          onClick={() => setCollapsed(false)}
        >
          <NomiAILabel markSize={18} wordSize={13} suffix="生成" />
        </WorkbenchButton>
      </aside>
    )
  }

  return (
    <aside
      className={cn(
        'generation-canvas-v2-assistant',
        'grid grid-rows-[auto_minmax(0,1fr)_auto] w-[340px] h-full',
        'max-h-none min-w-0 min-h-0 overflow-hidden',
        'border-0 rounded-none bg-nomi-paper shadow-none',
        'max-[900px]:w-[min(340px,calc(100vw-28px))]',
        'max-[900px]:max-h-[calc(100vh-var(--workbench-topbar-height)-var(--workbench-timeline-height)-32px)]',
        'max-[900px]:border max-[900px]:border-nomi-line max-[900px]:rounded-nomi max-[900px]:shadow-nomi-lg',
      )}
      data-collapsed="false"
      aria-label="生成区 AI 助手"
    >
      <header className={cn(
        'flex items-center justify-between gap-[10px]',
        'min-h-[53px] px-4 py-[14px]',
        'border-b border-nomi-line-soft bg-nomi-paper',
      )}>
        <div className={cn('flex items-center gap-2 min-w-0')}>
          <NomiAILabel suffix="生成" />
        </div>
        <div className={cn('inline-flex items-center flex-nowrap gap-[6px] ml-auto')}>
          <WorkbenchAiHeaderActions
            className="generation-canvas-v2-assistant__shared-actions"
            actionClassName={cn(
              'min-w-[26px] w-[26px] h-[26px] inline-grid place-items-center',
              'p-0 border-0 rounded-nomi-sm bg-transparent',
              'text-nomi-ink-60 font-[inherit] text-[12.5px] cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            onModelIntegration={openWorkbenchModelIntegration}
            onNewConversation={handleNewConversation}
          />
          <WorkbenchIconButton
            className={cn(
              'min-w-[26px] w-[26px] h-[26px] inline-grid place-items-center',
              'p-0 border-0 rounded-nomi-sm bg-transparent',
              'text-nomi-ink-60 font-[inherit] text-[12.5px] cursor-pointer',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            label="收起 AI"
            onClick={() => setCollapsed(true)}
            icon={<IconX size={14} />}
          />
        </div>
      </header>
      <div className={cn('flex flex-col gap-3 min-h-0 overflow-auto p-4')}>
        {pendingToolCalls.length > 0 ? (
          <div
            className={cn(
              'flex flex-col gap-2 p-3 rounded-nomi border border-nomi-accent-soft bg-nomi-accent-soft/40',
            )}
            data-pending-tool-calls="true"
            aria-label="待确认的 Agent 工具调用"
          >
            <div className={cn('text-nomi-accent text-[12px] font-medium uppercase tracking-wider')}>
              Agent 准备调用工具
            </div>
            {pendingToolCalls.map((call) => (
              <div
                key={call.toolCallId}
                className={cn('flex flex-col gap-2 p-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line-soft')}
                data-tool-call-id={call.toolCallId}
              >
                <div className={cn('text-nomi-ink text-[13px] font-medium')}>{call.toolName}</div>
                <div className={cn('text-nomi-ink-80 text-[12.5px]')}>{summarizeToolCall(call.toolName, call.args)}</div>
                <details className={cn('text-nomi-ink-60 text-[11.5px]')}>
                  <summary className={cn('cursor-pointer select-none')}>查看参数</summary>
                  <pre className={cn('mt-1 max-h-[160px] overflow-auto p-2 rounded-nomi-sm bg-nomi-ink-05 text-[11px] leading-[1.4] whitespace-pre-wrap break-all')}>
                    {JSON.stringify(call.args, null, 2)}
                  </pre>
                </details>
                <div className={cn('flex items-center justify-end gap-2 mt-1')}>
                  <WorkbenchButton
                    className={cn(
                      'h-7 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-[12px] cursor-pointer',
                      'hover:bg-nomi-ink-05',
                    )}
                    onClick={() => resolvePending(call.toolCallId, { ok: false, message: 'rejected by user' })}
                  >
                    拒绝
                  </WorkbenchButton>
                  <WorkbenchButton
                    className={cn(
                      'h-7 px-3 rounded-nomi-sm border-0 bg-nomi-ink text-nomi-paper text-[12px] cursor-pointer',
                      'hover:bg-nomi-accent',
                    )}
                    onClick={() => resolvePending(call.toolCallId, { ok: true, result: { confirmed: true } })}
                  >
                    确认
                  </WorkbenchButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className={cn(
            'flex flex-1 flex-col items-center justify-center gap-[10px]',
            'max-w-[240px] mx-auto py-6 px-3 text-center',
          )}>
            <div className={cn('text-nomi-ink font-[Fraunces,Inter,serif] text-[17px] font-medium')}>需要 AI 帮忙？</div>
            <div className={cn('text-nomi-ink-60 text-[13px] leading-[1.55]')}>
              告诉 AI 你想怎么改，它会写入待确认节点。
            </div>
            <div className={cn('flex flex-col gap-[6px] w-full mt-2')}>
              {['把第一帧改成黄昏色调', '在末尾追加一帧', '整体风格统一为水彩'].map((suggestion) => (
                <WorkbenchButton
                  key={suggestion}
                  className={cn(
                    'min-h-[34px] py-2 px-3 border border-transparent rounded-nomi',
                    'bg-nomi-ink-05 text-nomi-ink-80 font-[inherit] text-[12.5px] text-left cursor-pointer',
                    'hover:border-nomi-line hover:bg-nomi-paper hover:text-nomi-ink',
                  )}
                  onClick={() => setDraft(suggestion)}
                >
                  {suggestion}
                </WorkbenchButton>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'relative max-w-[90%] py-[10px] px-[14px] rounded-nomi',
                'bg-nomi-ink-05 text-nomi-ink text-[13.5px] leading-[1.55] whitespace-pre-wrap',
                message.role === 'user' && 'self-end rounded-br-[4px] bg-nomi-ink text-nomi-paper',
                message.role === 'assistant' && 'self-start rounded-bl-[4px]',
                message.role === 'tool' && 'self-start bg-nomi-accent-soft text-nomi-accent',
              )}
              data-role={message.role}
            >
              {message.content}
              {message.role !== 'user' ? (
                <AiReplyActionButton
                  className="generation-canvas-v2-assistant__reply-action"
                  content={message.content}
                />
              ) : null}
            </div>
          ))
        )}
      </div>
      <form
        className={cn('grid gap-1 p-3 border-t border-nomi-line-soft bg-nomi-paper')}
        onSubmit={handleSubmit}
      >
        <textarea
          className={cn(
            'w-full min-h-[40px] p-0 border-0 outline-0 resize-none',
            'bg-transparent text-nomi-ink font-[inherit] text-[13.5px] leading-[1.45]',
            'placeholder:text-nomi-ink-40',
          )}
          aria-label="给生成助手发送消息"
          rows={1}
          placeholder="输入你的设计需求..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => handleAiComposerKeyDown(event, () => {
            event.currentTarget.form?.requestSubmit()
          })}
          disabled={busy}
        />
        <div className={cn('flex items-center justify-between gap-3')}>
          <label className={cn('flex items-center gap-[6px]')}>
            <span className={cn('text-nomi-ink-40 text-[11.5px]')}>模式</span>
            <select
              className={cn(
                'h-[25px] px-[6px] py-[3px]',
                'border border-nomi-line-soft rounded-nomi-sm outline-0',
                'bg-nomi-ink-05 text-nomi-ink-80 font-[inherit] text-xs',
              )}
              aria-label="AI 模式"
              value={mode}
              onChange={(event) => setMode(event.currentTarget.value as 'agent' | 'chat' | 'refine')}
            >
              <option value="agent">Agent</option>
              <option value="chat">问答</option>
              <option value="refine">润色</option>
            </select>
          </label>
          <WorkbenchIconButton
            type="submit"
            className={cn(
              'w-[30px] h-[30px] grid place-items-center',
              'border-0 rounded-full bg-nomi-ink text-nomi-paper cursor-pointer',
              'hover:enabled:bg-nomi-accent',
              'disabled:bg-nomi-ink-20 disabled:text-nomi-ink-40 disabled:cursor-not-allowed',
            )}
            disabled={busy || !draft.trim()}
            label="发送"
            aria-label="生成 AI 发送"
            icon={<IconSend2 size={15} />}
          />
        </div>
      </form>
    </aside>
  )
}
