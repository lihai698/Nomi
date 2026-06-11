import type { StateCreator } from 'zustand'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationCanvasSnapshot,
  GenerationNodeKind,
  GenerationNodeResult,
  GenerationNodeRunRecord,
  GenerationNodeStatus,
  NodeGroup,
} from '../model/generationCanvasTypes'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import type { CanvasMutationOptions } from './canvasGuards'
import type { NodeProgressInput, NodeRunRecordInput, NodeRunRecordPatch } from './runRecordHelpers'

export type CreateNodeInput = {
  kind: GenerationNodeKind
  title?: string
  prompt?: string
  position?: { x: number; y: number }
  categoryId?: string
  select?: boolean
}

export type CanvasNodeActions = {
  addNode: (input: CreateNodeInput) => GenerationCanvasNode
  commitPersistedChange: () => void
  updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>, options?: CanvasMutationOptions) => void
  updateNodePrompt: (nodeId: string, prompt: string) => void
  moveNode: (nodeId: string, position: { x: number; y: number }, options?: CanvasMutationOptions) => void
  moveSelectedNodes: (delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  deleteSelectedNodes: () => void
  selectNode: (nodeId: string, additive?: boolean) => void
  clearSelection: () => void
  selectAllNodes: (categoryId?: string) => void
  duplicateNodeForRegeneration: (nodeId: string) => GenerationCanvasNode | null
  /** Phase E: move a node into a different category (sidebar drop / right-click). */
  reassignNodeCategory: (nodeId: string, categoryId: string) => void
  copyNodeToCategory: (nodeId: string, categoryId: string) => GenerationCanvasNode | null
  deleteNode: (nodeId: string) => void
}

export type CanvasGraphActions = {
  startConnection: (nodeId: string) => void
  cancelConnection: () => void
  connectToNode: (targetNodeId: string) => void
  connectNodes: (sourceNodeId: string, targetNodeId: string, mode?: GenerationCanvasEdge['mode']) => void
  updateEdgeMode: (edgeId: string, mode: GenerationCanvasEdge['mode']) => void
  disconnectEdge: (edgeId: string) => void
  moveGroupNodes: (groupId: string, delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  createGroup: (categoryId: string, name?: string) => NodeGroup | null
  groupSelectedNodes: (categoryId: string, name?: string) => NodeGroup | null
  renameGroup: (groupId: string, name: string) => void
  setGroupColor: (groupId: string, color: string) => void
  ungroup: (groupId: string) => void
  ungroupGroups: (groupIds: string[]) => void
  deleteGroup: (groupId: string, deleteNodes?: boolean) => void
  moveNodeToGroup: (nodeId: string, groupId: string) => void
  removeNodeFromGroup: (nodeId: string) => void
  reorderGroup: (categoryId: string, activeGroupId: string, overGroupId: string) => void
}

export type CanvasRunActions = {
  setNodeStatus: (nodeId: string, status: GenerationNodeStatus, error?: string) => void
  setNodeProgress: (nodeId: string, progress?: NodeProgressInput) => void
  appendNodeRun: (nodeId: string, run: NodeRunRecordInput) => GenerationNodeRunRecord
  trackNodeRun: (nodeId: string, runId: string, patch: NodeRunRecordPatch) => void
  addNodeResult: (nodeId: string, result: GenerationNodeResult) => void
  rollbackHistory: (nodeId: string, resultId: string) => void
}

export type GenerationCanvasState = {
  isReady: boolean
  persistRevision: number
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
  selectedNodeIds: string[]
  pendingConnectionSourceId: string
  canvasZoom: number
  canvasOffset: { x: number; y: number }
  generationAiDraft: string
  generationAiMessages: WorkbenchAiMessage[]
  generationAiCollapsed: boolean
  canUndo: boolean
  canRedo: boolean
  hasClipboard: boolean
  markReady: () => void
  captureHistory: () => void
  setCanvasTransform: (zoom: number, offset: { x: number; y: number }) => void
  setCanvasZoom: (zoom: number) => void
  setGenerationAiDraft: (draft: string) => void
  setGenerationAiMessages: (messages: WorkbenchAiMessage[] | ((messages: WorkbenchAiMessage[]) => WorkbenchAiMessage[])) => void
  setGenerationAiCollapsed: (collapsed: boolean) => void
  resetGenerationAiConversation: () => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: () => void
  undo: () => void
  redo: () => void
  readSnapshot: () => GenerationCanvasSnapshot
  restoreSnapshot: (snapshot: unknown) => void
} & CanvasNodeActions & CanvasGraphActions & CanvasRunActions

/** Slice creator typed against the store's middleware stack (subscribeWithSelector + immer). */
export type CanvasSliceCreator<T> = StateCreator<
  GenerationCanvasState,
  [['zustand/subscribeWithSelector', never], ['zustand/immer', never]],
  [],
  T
>
