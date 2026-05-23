import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { sendGenerationNodeToTimeline } from './sendGenerationNodeToTimeline'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

export type SendStoryboardToTimelineResult = {
  ok: boolean
  total: number
  sent: Array<{ nodeId: string; clipId: string; trackType: string; startFrame: number }>
  skipped: Array<{ nodeId: string; reason: string }>
}

/**
 * Order a set of generation-canvas node ids following the timeline-style
 * edges that connect them. The intent: when the agent built a linear
 * `n1 -> n2 -> n3` storyboard, send clips to the timeline in that order
 * regardless of how the user happened to multi-select on the canvas.
 *
 * Falls back to the input order when the selected nodes don't form a
 * simple chain (e.g. branches or disconnected sub-graphs).
 */
export function orderNodesByEdges(
  nodeIds: readonly string[],
  edges: readonly GenerationCanvasEdge[],
): string[] {
  const selected = new Set(nodeIds)
  if (selected.size <= 1) return [...nodeIds]
  const relevantEdges = edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target))
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const id of selected) {
    incoming.set(id, 0)
    outgoing.set(id, [])
  }
  for (const edge of relevantEdges) {
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)
    outgoing.get(edge.source)!.push(edge.target)
  }

  // Find a single source (zero in-degree) and walk forward.
  const sources: string[] = []
  for (const [id, count] of incoming.entries()) {
    if (count === 0) sources.push(id)
  }
  if (sources.length !== 1) return [...nodeIds]

  const ordered: string[] = []
  const visited = new Set<string>()
  let current: string | undefined = sources[0]
  while (current && !visited.has(current)) {
    visited.add(current)
    ordered.push(current)
    const next = outgoing.get(current) || []
    if (next.length !== 1) break
    current = next[0]
  }
  if (ordered.length !== selected.size) return [...nodeIds]
  return ordered
}

export type SendStoryboardToTimelineOptions = {
  /** Clip duration in frames per image node. Defaults to 3 seconds at the timeline's fps. */
  framesPerClip?: number
}

/**
 * Walk the ordered node list, append each generation node onto the
 * timeline (image track for image nodes, video track for video nodes),
 * advancing the cursor by each clip's frame count. Returns a structured
 * summary so callers can show a toast like "已发送 6 / 6 节点到时间轴".
 */
export function sendStoryboardToTimeline(
  nodeIds: readonly string[],
  _options: SendStoryboardToTimelineOptions = {},
): SendStoryboardToTimelineResult {
  const canvasState = useGenerationCanvasStore.getState()
  const ordered = orderNodesByEdges(nodeIds, canvasState.edges)
  const timeline = useWorkbenchStore.getState().timeline
  let cursor = Math.max(0, Math.floor(timeline.playheadFrame ?? 0))
  const sent: SendStoryboardToTimelineResult['sent'] = []
  const skipped: SendStoryboardToTimelineResult['skipped'] = []

  for (const nodeId of ordered) {
    const node: GenerationCanvasNode | undefined = useGenerationCanvasStore
      .getState()
      .nodes.find((candidate) => candidate.id === nodeId)
    if (!node) {
      skipped.push({ nodeId, reason: 'node_not_found' })
      continue
    }
    const result = sendGenerationNodeToTimeline(
      {
        readGenerationNodes: () => useGenerationCanvasStore.getState().nodes,
        readTimeline: () => useWorkbenchStore.getState().timeline,
        addTimelineClipAtFrame: (clip, trackType, startFrame) => {
          useWorkbenchStore.getState().addTimelineClipAtFrame(clip, trackType, startFrame)
        },
        readTimelineAfterInsert: () => useWorkbenchStore.getState().timeline,
      },
      nodeId,
      { startFrame: cursor },
    )
    if (result.ok) {
      cursor = result.startFrame + result.clip.frameCount
      sent.push({ nodeId, clipId: result.clip.id, trackType: result.trackType, startFrame: result.startFrame })
    } else {
      skipped.push({ nodeId, reason: result.error })
    }
  }

  return {
    ok: sent.length > 0,
    total: ordered.length,
    sent,
    skipped,
  }
}
