// 画布撤销/重做：模块级单例可变状态 + mutator API。
// S5-b-0:剪贴板已迁 canvasClipboard.ts(评审 P1——本文件将随翻正删除,价值先迁走);
// 本文件只剩历史栈职责,语义逐字等价(HISTORY_LIMIT、slice 顺序、redo 清空时机)。
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { __resetCanvasClipboardForTests } from './canvasClipboard'

export type GenerationCanvasHistoryState = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
  selectedNodeIds: string[]
  pendingConnectionSourceId: string
}

const HISTORY_LIMIT = 80

let undoStack: GenerationCanvasHistoryState[] = []
let redoStack: GenerationCanvasHistoryState[] = []

export function getHistoryFlags(): { canUndo: boolean; canRedo: boolean } {
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
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

export function clearHistory(): void {
  undoStack = []
  redoStack = []
}

export function __resetGenerationCanvasHistoryForTests(): void {
  undoStack = []
  redoStack = []
  __resetCanvasClipboardForTests()
}
