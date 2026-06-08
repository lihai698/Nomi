// 画布撤销/重做/剪贴板：模块级单例可变状态 + mutator API。从 generationCanvasStore.ts 抽出。
// 原 store 直接读写 undoStack/redoStack/clipboard 三个模块变量；抽出后改为调用本文件的 API，
// 语义逐字等价（HISTORY_LIMIT、slice 顺序、redo 清空时机、peek-then-mutate 均保持）。
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { CLIPBOARD_OFFSET, createClipboardNodeId } from './canvasIds'

export type GenerationCanvasHistoryState = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
  selectedNodeIds: string[]
  pendingConnectionSourceId: string
}

export type GenerationCanvasClipboard = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
}

const HISTORY_LIMIT = 80

let undoStack: GenerationCanvasHistoryState[] = []
let redoStack: GenerationCanvasHistoryState[] = []
let clipboard: GenerationCanvasClipboard | null = null

export function getHistoryFlags(): { canUndo: boolean; canRedo: boolean; hasClipboard: boolean } {
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    hasClipboard: clipboard !== null,
  }
}

function snapshotHistoryState(state: GenerationCanvasHistoryState): GenerationCanvasHistoryState {
  return {
    nodes: state.nodes,
    edges: state.edges,
    groups: state.groups,
    selectedNodeIds: state.selectedNodeIds,
    pendingConnectionSourceId: state.pendingConnectionSourceId,
  }
}

export function pushUndoSnapshot(state: GenerationCanvasHistoryState): void {
  undoStack = [...undoStack, snapshotHistoryState(state)].slice(-HISTORY_LIMIT)
  redoStack = []
}

// 等价于原 undo 的 stack 操作：peek 栈顶，空则不动返回 undefined；否则弹出 undo、把当前态压入 redo。
export function popUndo(currentState: GenerationCanvasHistoryState): GenerationCanvasHistoryState | undefined {
  const previous = undoStack.at(-1)
  if (!previous) return undefined
  undoStack = undoStack.slice(0, -1)
  redoStack = [...redoStack, snapshotHistoryState(currentState)].slice(-HISTORY_LIMIT)
  return previous
}

export function popRedo(currentState: GenerationCanvasHistoryState): GenerationCanvasHistoryState | undefined {
  const next = redoStack.at(-1)
  if (!next) return undefined
  redoStack = redoStack.slice(0, -1)
  undoStack = [...undoStack, snapshotHistoryState(currentState)].slice(-HISTORY_LIMIT)
  return next
}

export function buildSelectedClipboard(
  state: { selectedNodeIds: string[]; nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] },
): GenerationCanvasClipboard | null {
  const selected = new Set(state.selectedNodeIds)
  if (!selected.size) return null
  const nodes = state.nodes.filter((node) => selected.has(node.id))
  if (!nodes.length) return null
  return {
    nodes,
    edges: state.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)),
  }
}

export function cloneClipboardPayload(payload: GenerationCanvasClipboard): GenerationCanvasHistoryState {
  const idMap = new Map<string, string>()
  const nodes = payload.nodes.map((node) => {
    const nextId = createClipboardNodeId(node.id)
    idMap.set(node.id, nextId)
    return {
      ...node,
      id: nextId,
      title: node.title ? `${node.title} 副本` : node.title,
      position: {
        x: node.position.x + CLIPBOARD_OFFSET,
        y: node.position.y + CLIPBOARD_OFFSET,
      },
    }
  })
  const edges = payload.edges.flatMap((edge) => {
    const source = idMap.get(edge.source)
    const target = idMap.get(edge.target)
    if (!source || !target) return []
    return [{
      ...edge,
      id: `edge-${source}-${target}`,
      source,
      target,
    }]
  })
  return {
    nodes,
    edges,
    groups: [],
    selectedNodeIds: nodes.map((node) => node.id),
    pendingConnectionSourceId: '',
  }
}

export function setClipboard(payload: GenerationCanvasClipboard | null): void {
  clipboard = payload
}

export function getClipboard(): GenerationCanvasClipboard | null {
  return clipboard
}

export function clearHistory(): void {
  undoStack = []
  redoStack = []
  clipboard = null
}

export function __resetGenerationCanvasHistoryForTests(): void {
  undoStack = []
  redoStack = []
  clipboard = null
}
