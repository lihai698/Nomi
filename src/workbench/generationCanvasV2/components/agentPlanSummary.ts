export type PendingToolCallLike = {
  toolCallId: string
  toolName: string
  args: unknown
}

export type PlannedNode = {
  clientId: string
  kind: string
  title: string
  prompt: string
  position?: { x: number; y: number }
}

export type PlannedEdge = {
  sourceClientId: string
  targetClientId: string
}

export type AgentPlanSummary = {
  summary: string
  nodes: PlannedNode[]
  edges: PlannedEdge[]
  createCallId: string
  connectCallId: string | null
}

/**
 * Pure helper extracted from AgentPlanCard so it can be unit-tested
 * without pulling in React. Detects a `create_canvas_nodes` call
 * optionally paired with `connect_canvas_edges` and folds them into a
 * single summary the storyboard plan card can render.
 */
export function summarizeAgentPlan(calls: readonly PendingToolCallLike[]): AgentPlanSummary | null {
  const createCall = calls.find((call) => call.toolName === 'create_canvas_nodes')
  if (!createCall) return null
  const createArgs = (createCall.args && typeof createCall.args === 'object')
    ? createCall.args as Record<string, unknown>
    : {}
  const rawNodes = Array.isArray(createArgs.nodes) ? createArgs.nodes : []
  if (rawNodes.length === 0) return null
  const nodes: PlannedNode[] = rawNodes.map((raw, index) => {
    const node = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
    const position = (node.position && typeof node.position === 'object') ? node.position as Record<string, unknown> : null
    return {
      clientId: typeof node.clientId === 'string' && node.clientId.trim()
        ? node.clientId
        : `n${index + 1}`,
      kind: typeof node.kind === 'string' ? node.kind : 'image',
      title: typeof node.title === 'string' ? node.title : `镜头 ${index + 1}`,
      prompt: typeof node.prompt === 'string' ? node.prompt : '',
      ...(position && typeof position.x === 'number' && typeof position.y === 'number'
        ? { position: { x: position.x, y: position.y } }
        : {}),
    }
  })

  const connectCall = calls.find((call) => call.toolName === 'connect_canvas_edges')
  let edges: PlannedEdge[] = []
  if (connectCall) {
    const connectArgs = (connectCall.args && typeof connectCall.args === 'object')
      ? connectCall.args as Record<string, unknown>
      : {}
    const rawEdges = Array.isArray(connectArgs.edges) ? connectArgs.edges : []
    edges = rawEdges
      .map((raw) => (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {})
      .map((edge) => ({
        sourceClientId: String(edge.sourceClientId || edge.source || '').trim(),
        targetClientId: String(edge.targetClientId || edge.target || '').trim(),
      }))
      .filter((edge) => edge.sourceClientId && edge.targetClientId)
  }

  const summary = typeof createArgs.summary === 'string' && createArgs.summary.trim()
    ? createArgs.summary.trim()
    : `${nodes.length} 个镜头 + ${edges.length} 条引用边`

  return {
    summary,
    nodes,
    edges,
    createCallId: createCall.toolCallId,
    connectCallId: connectCall?.toolCallId ?? null,
  }
}
