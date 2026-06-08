import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import {
  connectNodes,
  createGenerationNode,
  disconnectEdge,
  removeNodes,
  rollbackNodeHistory,
  upsertNode,
} from '../model/graphOps'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
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
import { CLIPBOARD_OFFSET, createClipboardNodeId, createGroupId, createNodeId, createRunId } from './canvasIds'
import { type CanvasMutationOptions, bumpPersistRevision, isCategoryId, shouldPersistCanvasMutation } from './canvasGuards'
import {
  buildSelectedClipboard,
  clearHistory,
  cloneClipboardPayload,
  getClipboard,
  getHistoryFlags,
  popRedo,
  popUndo,
  pushUndoSnapshot,
  setClipboard,
} from './canvasHistory'
import {
  type NodeProgressInput,
  type NodeRunRecordInput,
  type NodeRunRecordPatch,
  createProgress,
  getResultTaskKind,
  getRunDurationSeconds,
  mergeRunRecord,
} from './runRecordHelpers'
import { normalizeStoreSnapshot, seedNodes } from './canvasSnapshotNormalizer'

export { __resetGenerationCanvasHistoryForTests } from './canvasHistory'

type CreateNodeInput = {
  kind: GenerationNodeKind
  title?: string
  prompt?: string
  position?: { x: number; y: number }
  categoryId?: string
  select?: boolean
}

type GenerationCanvasState = {
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
  addNode: (input: CreateNodeInput) => GenerationCanvasNode
  commitPersistedChange: () => void
  updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>, options?: CanvasMutationOptions) => void
  updateNodePrompt: (nodeId: string, prompt: string) => void
  moveNode: (nodeId: string, position: { x: number; y: number }, options?: CanvasMutationOptions) => void
  moveSelectedNodes: (delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  moveGroupNodes: (groupId: string, delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  deleteSelectedNodes: () => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: () => void
  undo: () => void
  redo: () => void
  selectNode: (nodeId: string, additive?: boolean) => void
  clearSelection: () => void
  selectAllNodes: (categoryId?: string) => void
  startConnection: (nodeId: string) => void
  cancelConnection: () => void
  connectToNode: (targetNodeId: string) => void
  connectNodes: (sourceNodeId: string, targetNodeId: string, mode?: GenerationCanvasEdge['mode']) => void
  updateEdgeMode: (edgeId: string, mode: GenerationCanvasEdge['mode']) => void
  disconnectEdge: (edgeId: string) => void
  setNodeStatus: (nodeId: string, status: GenerationNodeStatus, error?: string) => void
  setNodeProgress: (nodeId: string, progress?: NodeProgressInput) => void
  appendNodeRun: (nodeId: string, run: NodeRunRecordInput) => GenerationNodeRunRecord
  trackNodeRun: (nodeId: string, runId: string, patch: NodeRunRecordPatch) => void
  addNodeResult: (nodeId: string, result: GenerationNodeResult) => void
  duplicateNodeForRegeneration: (nodeId: string) => GenerationCanvasNode | null
  /** Phase E: move a node into a different category (sidebar drop / right-click). */
  reassignNodeCategory: (nodeId: string, categoryId: string) => void
  copyNodeToCategory: (nodeId: string, categoryId: string) => GenerationCanvasNode | null
  deleteNode: (nodeId: string) => void
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
  rollbackHistory: (nodeId: string, resultId: string) => void
  readSnapshot: () => GenerationCanvasSnapshot
  restoreSnapshot: (snapshot: unknown) => void
}

export const useGenerationCanvasStore = create<GenerationCanvasState>()(subscribeWithSelector(immer((set, get) => ({
  isReady: false,
  persistRevision: 0,
  nodes: seedNodes,
  edges: [{ id: 'edge-gen-v2-text-1-gen-v2-image-1', source: 'gen-v2-text-1', target: 'gen-v2-image-1' }],
  groups: [],
  selectedNodeIds: [],
  pendingConnectionSourceId: '',
  canvasZoom: 1,
  canvasOffset: { x: 0, y: 0 },
  generationAiDraft: '',
  generationAiMessages: [],
  generationAiCollapsed: true,
  canUndo: false,
  canRedo: false,
  hasClipboard: false,
  markReady: () => set({ isReady: true }),
  captureHistory: () => {
    pushUndoSnapshot(get())
    set((state) => {
      Object.assign(state, getHistoryFlags())
    })
  },
  setCanvasTransform: (zoom, offset) => set({ canvasZoom: zoom, canvasOffset: offset }),
  setCanvasZoom: (zoom) => set({ canvasZoom: zoom }),
  setGenerationAiDraft: (generationAiDraft) => {
    set({ generationAiDraft })
  },
  setGenerationAiMessages: (messages) => {
    set((state) => {
      state.generationAiMessages = typeof messages === 'function' ? messages(state.generationAiMessages) : messages
    })
  },
  setGenerationAiCollapsed: (generationAiCollapsed) => {
    set({ generationAiCollapsed })
  },
  resetGenerationAiConversation: () => {
    set({ generationAiDraft: '', generationAiMessages: [] })
  },
  addNode: (input) => {
    const currentState = get()
    const existingCount = currentState.nodes.filter((node) => node.kind === input.kind).length
    const categoryId = isCategoryId(input.categoryId) ? input.categoryId : undefined
    const baseNode = createGenerationNode({
      id: createNodeId(input.kind),
      kind: input.kind,
      title: input.title,
      prompt: input.prompt,
      x: input.position?.x ?? 120 + existingCount * 34,
      y: input.position?.y ?? 360 + existingCount * 30,
    })
    const nextNode = categoryId ? { ...baseNode, categoryId } : baseNode
    pushUndoSnapshot(currentState)
    set((state) => {
      state.nodes = upsertNode(state.nodes, nextNode)
      state.selectedNodeIds = input.select === false ? state.selectedNodeIds : [nextNode.id]
      state.pendingConnectionSourceId = ''
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    return nextNode
  },
  commitPersistedChange: () => {
    set((state) => {
      bumpPersistRevision(state)
    })
  },
  updateNode: (nodeId, patch, options) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      Object.assign(node, patch)
      if (shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
  },
  updateNodePrompt: (nodeId, prompt) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      node.prompt = prompt
      bumpPersistRevision(state)
    })
  },
  moveNode: (nodeId, position, options) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      if (node.position.x === position.x && node.position.y === position.y) return
      node.position = position
      if (shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
  },
  moveSelectedNodes: (delta, options) => {
    set((state) => {
      const selected = new Set(state.selectedNodeIds)
      if (!selected.size || (delta.x === 0 && delta.y === 0)) return
      let moved = false
      for (const node of state.nodes) {
        if (!selected.has(node.id)) continue
        node.position = {
          x: Math.round(node.position.x + delta.x),
          y: Math.round(node.position.y + delta.y),
        }
        moved = true
      }
      if (moved && shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
  },
  moveGroupNodes: (groupId, delta, options) => {
    set((state) => {
      if (delta.x === 0 && delta.y === 0) return
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group?.nodeIds.length) return
      const nodeIds = new Set(group.nodeIds)
      let moved = false
      for (const node of state.nodes) {
        if (!nodeIds.has(node.id) || (node.categoryId || 'shots') !== group.categoryId) continue
        node.position = {
          x: Math.round(node.position.x + delta.x),
          y: Math.round(node.position.y + delta.y),
        }
        moved = true
      }
      if (!moved) return
      group.updatedAt = Date.now()
      if (shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
  },
  deleteSelectedNodes: () => {
    const currentState = get()
    if (!currentState.selectedNodeIds.length) return
    pushUndoSnapshot(currentState)
    set((state) => {
      const next = removeNodes(state.nodes, state.edges, state.selectedNodeIds)
      state.nodes = next.nodes
      state.edges = next.edges
      state.selectedNodeIds = []
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  copySelectedNodes: () => {
    const nextClipboard = buildSelectedClipboard(get())
    if (!nextClipboard) return
    setClipboard(nextClipboard)
    set(getHistoryFlags())
  },
  cutSelectedNodes: () => {
    const currentState = get()
    const nextClipboard = buildSelectedClipboard(currentState)
    if (!nextClipboard) return
    setClipboard(nextClipboard)
    pushUndoSnapshot(currentState)
    set((state) => {
      const next = removeNodes(state.nodes, state.edges, state.selectedNodeIds)
      state.nodes = next.nodes
      state.edges = next.edges
      state.selectedNodeIds = []
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  pasteNodes: () => {
    const currentState = get()
    const clipboardPayload = getClipboard()
    if (!clipboardPayload) return
    const cloned = cloneClipboardPayload(clipboardPayload)
    if (!cloned.nodes.length) return
    pushUndoSnapshot(currentState)
    setClipboard({
      nodes: cloned.nodes,
      edges: cloned.edges,
    })
    set((state) => {
      state.nodes = [...state.nodes, ...cloned.nodes]
      state.edges = [...state.edges, ...cloned.edges]
      state.selectedNodeIds = cloned.selectedNodeIds
      state.pendingConnectionSourceId = ''
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  undo: () => {
    const currentState = get()
    const previous = popUndo(currentState)
    if (!previous) return
    set((state) => {
      state.nodes = previous.nodes
      state.edges = previous.edges
      state.groups = previous.groups
      state.selectedNodeIds = previous.selectedNodeIds
      state.pendingConnectionSourceId = previous.pendingConnectionSourceId
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  redo: () => {
    const currentState = get()
    const next = popRedo(currentState)
    if (!next) return
    set((state) => {
      state.nodes = next.nodes
      state.edges = next.edges
      state.groups = next.groups
      state.selectedNodeIds = next.selectedNodeIds
      state.pendingConnectionSourceId = next.pendingConnectionSourceId
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  selectNode: (nodeId, additive = false) => {
    set((state) => {
      if (!additive) {
        state.selectedNodeIds = [nodeId]
        return
      }
      const nextIds = state.selectedNodeIds.includes(nodeId)
        ? state.selectedNodeIds.filter((id) => id !== nodeId)
        : [...state.selectedNodeIds, nodeId]
      state.selectedNodeIds = nextIds
    })
  },
  clearSelection: () => {
    set({ selectedNodeIds: [], pendingConnectionSourceId: '' })
  },
  // v0.7.5: 全选当前分类的所有节点（如果传 categoryId 则限定，否则全选画布所有节点）
  selectAllNodes: (categoryId?: string) => {
    set((state) => {
      const ids = state.nodes
        .filter((n) => !categoryId || (n.categoryId || 'shots') === categoryId)
        .map((n) => n.id)
      state.selectedNodeIds = ids
    })
  },
  startConnection: (nodeId) => {
    set({ pendingConnectionSourceId: nodeId })
  },
  cancelConnection: () => {
    set({ pendingConnectionSourceId: '' })
  },
  connectToNode: (targetNodeId) => {
    const sourceNodeId = get().pendingConnectionSourceId
    if (!sourceNodeId) return
    set((state) => {
      const sourceNode = state.nodes.find((n) => n.id === sourceNodeId)
      const targetNode = state.nodes.find((n) => n.id === targetNodeId)
      let mode: GenerationCanvasEdge['mode'] = 'reference'
      if (sourceNode && targetNode && isImageLikeGenerationNodeKind(sourceNode.kind) && targetNode.kind === 'video') {
        const incoming = state.edges.filter((e) => e.target === targetNodeId)
        if (!incoming.some((e) => e.mode === 'first_frame')) mode = 'first_frame'
        else if (!incoming.some((e) => e.mode === 'last_frame')) mode = 'last_frame'
      }
      const nextEdges = connectNodes(state.edges, sourceNodeId, targetNodeId, mode)
      if (nextEdges !== state.edges) {
        state.edges = nextEdges
        bumpPersistRevision(state)
      }
      state.pendingConnectionSourceId = ''
    })
  },
  connectNodes: (sourceNodeId, targetNodeId, mode) => {
    set((state) => {
      const nextEdges = connectNodes(state.edges, sourceNodeId, targetNodeId, mode)
      if (nextEdges === state.edges) return
      state.edges = nextEdges
      bumpPersistRevision(state)
    })
  },
  updateEdgeMode: (edgeId, mode) => {
    set((state) => {
      const edge = state.edges.find((candidate) => candidate.id === edgeId)
      if (!edge || edge.mode === mode) return
      edge.mode = mode
      bumpPersistRevision(state)
    })
  },
  disconnectEdge: (edgeId) => {
    set((state) => {
      const nextEdges = disconnectEdge(state.edges, edgeId)
      if (nextEdges.length === state.edges.length) return
      state.edges = nextEdges
      bumpPersistRevision(state)
    })
  },
  setNodeStatus: (nodeId, status, error) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
        const nextError = status === 'error' ? error || node.error || 'Generation failed' : undefined
        const latestRun = node.runs?.[0]
      const runs = latestRun && latestRun.status !== 'success' && latestRun.status !== 'error' && latestRun.status !== 'cancelled'
          ? [mergeRunRecord(latestRun, { status: status === 'idle' ? 'cancelled' : status, error: nextError }), ...(node.runs || []).slice(1)]
          : node.runs

      node.status = status
      node.error = nextError
      node.progress = status === 'queued' || status === 'running' ? node.progress : undefined
      node.runs = runs
      bumpPersistRevision(state)
    })
  },
  setNodeProgress: (nodeId, progress) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      if (!progress) {
        node.progress = undefined
        bumpPersistRevision(state)
        return
      }
        const nextProgress = createProgress(progress, node.runs?.[0]?.id)
        const runs = node.runs?.length
          ? [
              mergeRunRecord(node.runs[0], {
                status: node.runs[0].status === 'queued' ? 'running' : node.runs[0].status,
                progress: nextProgress,
                taskId: nextProgress.taskId ?? node.runs[0].taskId,
                taskKind: nextProgress.taskKind ?? node.runs[0].taskKind,
              }, nextProgress.updatedAt),
              ...node.runs.slice(1),
            ]
          : node.runs
      node.status = node.status === 'queued' ? 'running' : node.status || 'running'
      node.error = undefined
      node.progress = nextProgress
      node.runs = runs
      bumpPersistRevision(state)
    })
  },
  appendNodeRun: (nodeId, run) => {
    const now = Date.now()
    const nextRun: GenerationNodeRunRecord = {
      ...run,
      id: run.id ?? createRunId(nodeId),
      startedAt: run.startedAt ?? now,
      updatedAt: run.updatedAt ?? now,
    }
    const normalizedRun = {
      ...nextRun,
      durationSeconds: getRunDurationSeconds(nextRun),
    }
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      node.status = normalizedRun.status === 'cancelled' ? 'idle' : normalizedRun.status
      node.error = normalizedRun.status === 'error' ? normalizedRun.error || node.error || 'Generation failed' : undefined
      node.progress = normalizedRun.progress
      node.runs = [normalizedRun, ...(node.runs || []).filter((entry) => entry.id !== normalizedRun.id)]
      bumpPersistRevision(state)
    })
    return normalizedRun
  },
  trackNodeRun: (nodeId, runId, patch) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
        const runIndex = (node.runs || []).findIndex((entry) => entry.id === runId)
      if (runIndex < 0) return
        const nextRuns = [...(node.runs || [])]
        const nextRun = mergeRunRecord(nextRuns[runIndex], patch)
        nextRuns[runIndex] = nextRun
        const isLatestRun = runIndex === 0
      node.status = isLatestRun ? (nextRun.status === 'cancelled' ? 'idle' : nextRun.status) : node.status
      node.error = isLatestRun && nextRun.status === 'error' ? nextRun.error || 'Generation failed' : undefined
      node.progress = isLatestRun ? nextRun.progress : node.progress
      node.runs = nextRuns
      bumpPersistRevision(state)
    })
  },
  addNodeResult: (nodeId, result) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
        const latestRun = node.runs?.[0]
        const completedAt = result.createdAt || Date.now()
        const runs = latestRun
          ? [
              mergeRunRecord(latestRun, {
                status: 'success',
                taskId: result.taskId ?? latestRun.taskId,
                taskKind: getResultTaskKind(result) ?? latestRun.taskKind,
                assetId: result.assetId ?? latestRun.assetId,
                assetRefId: result.assetRefId ?? latestRun.assetRefId,
                resultId: result.id,
                raw: result.raw ?? latestRun.raw,
                completedAt,
                durationSeconds: result.durationSeconds ?? latestRun.durationSeconds,
                progress: undefined,
                error: undefined,
              }, completedAt),
              ...(node.runs || []).slice(1),
            ]
          : node.runs
      node.result = result
      node.history = [result, ...(node.history || []).filter((entry) => entry.id !== result.id)]
      node.status = 'success'
      node.error = undefined
      node.progress = undefined
      node.runs = runs
      bumpPersistRevision(state)
    })
  },
  duplicateNodeForRegeneration: (nodeId) => {
    const state = get()
    const node = state.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return null
    const nextNode = createGenerationNode({
      id: createNodeId(node.kind),
      kind: node.kind,
      title: node.title,
      prompt: node.prompt,
      x: node.position.x + 40,
      y: node.position.y + 40,
    })
    const history = node.history ? [...node.history] : []
    const result = node.result
    if (result && !history.some((entry) => entry.id === result.id)) {
      history.unshift(result)
    }
    const copiedNode: GenerationCanvasNode = {
      ...nextNode,
      history,
      references: node.references ? [...node.references] : [],
      meta: node.meta ? { ...node.meta } : {},
      size: node.size ? { ...node.size } : nextNode.size,
      prompt: node.prompt || '',
      categoryId: node.categoryId,
      groupId: node.groupId,
      derivedFrom: node.id,
    }
    pushUndoSnapshot(state)
    set((current) => {
      const original = current.nodes.find((candidate) => candidate.id === nodeId)
      if (original && history.length) original.history = history
      current.nodes.push(copiedNode)
      if (copiedNode.groupId) {
        const group = current.groups.find((candidate) => candidate.id === copiedNode.groupId)
        if (group && !group.nodeIds.includes(copiedNode.id)) {
          group.nodeIds.push(copiedNode.id)
          group.updatedAt = Date.now()
        }
      }
      current.selectedNodeIds = [copiedNode.id]
      bumpPersistRevision(current)
      Object.assign(current, getHistoryFlags())
    })
    return copiedNode
  },
  reassignNodeCategory: (nodeId, categoryId) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      if (node.categoryId === id) return
      node.categoryId = id
      bumpPersistRevision(state)
    })
  },
  copyNodeToCategory: (nodeId, categoryId) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return null
    const source = get().nodes.find((candidate) => candidate.id === nodeId)
    if (!source) return null
    const { id: _sourceId, categoryId: _sourceCategoryId, groupId: _sourceGroupId, ...rest } = source
    const copiedNode: GenerationCanvasNode = {
      ...rest,
      id: createClipboardNodeId(source.id),
      title: source.title ? `${source.title} 副本` : source.title,
      position: {
        x: source.position.x + CLIPBOARD_OFFSET,
        y: source.position.y + CLIPBOARD_OFFSET,
      },
      categoryId: id,
      derivedFrom: source.id,
      references: source.references ? [...source.references] : undefined,
      history: source.history ? [...source.history] : undefined,
      runs: source.runs ? [...source.runs] : undefined,
      meta: source.meta ? { ...source.meta } : undefined,
      size: source.size ? { ...source.size } : source.size,
    }
    pushUndoSnapshot(get())
    set((state) => {
      state.nodes.push(copiedNode)
      state.selectedNodeIds = [copiedNode.id]
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    return copiedNode
  },
  deleteNode: (nodeId) => {
    const current = get()
    if (!current.nodes.some((candidate) => candidate.id === nodeId)) return
    pushUndoSnapshot(current)
    set((state) => {
      const next = removeNodes(state.nodes, state.edges, [nodeId])
      state.nodes = next.nodes
      state.edges = next.edges
      state.groups = state.groups.map((group) => ({
        ...group,
        nodeIds: group.nodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId),
      }))
      state.selectedNodeIds = state.selectedNodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  createGroup: (categoryId, name) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return null
    const now = Date.now()
    const existingCount = get().groups.filter((group) => group.categoryId === id).length
    const group: NodeGroup = {
      id: createGroupId(id),
      name: (name || '').trim() || `组 ${existingCount + 1}`,
      categoryId: id,
      nodeIds: [],
      createdAt: now,
      updatedAt: now,
    }
    pushUndoSnapshot(get())
    set((state) => {
      state.groups.push(group)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    return group
  },
  groupSelectedNodes: (categoryId, name) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return null
    const current = get()
    const selected = new Set(current.selectedNodeIds)
    const nodeIds = current.nodes
      .filter((node) => selected.has(node.id) && (node.categoryId || 'shots') === id)
      .map((node) => node.id)
    if (nodeIds.length < 2) return null
    const now = Date.now()
    const existingCount = current.groups.filter((group) => group.categoryId === id).length
    const group: NodeGroup = {
      id: createGroupId(id),
      name: (name || '').trim() || `组 ${existingCount + 1}`,
      categoryId: id,
      nodeIds,
      createdAt: now,
      updatedAt: now,
    }
    pushUndoSnapshot(current)
    set((state) => {
      for (const existingGroup of state.groups) {
        existingGroup.nodeIds = existingGroup.nodeIds.filter((nodeId) => !nodeIds.includes(nodeId))
      }
      for (const node of state.nodes) {
        if (nodeIds.includes(node.id)) node.groupId = group.id
      }
      state.groups.push(group)
      state.selectedNodeIds = nodeIds
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    return group
  },
  renameGroup: (groupId, name) => {
    const nextName = String(name || '').trim()
    if (!nextName) return
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing || existing.name === nextName) return
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      group.name = nextName
      group.updatedAt = Date.now()
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  setGroupColor: (groupId, color) => {
    const nextColor = String(color || '').trim()
    if (!nextColor) return
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing || existing.color === nextColor) return
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      group.color = nextColor
      group.updatedAt = Date.now()
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  ungroup: (groupId) => {
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing) return
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      const nodeIds = new Set(group.nodeIds)
      for (const node of state.nodes) {
        if (nodeIds.has(node.id)) delete node.groupId
      }
      state.groups = state.groups.filter((candidate) => candidate.id !== groupId)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  ungroupGroups: (groupIds) => {
    const current = get()
    const targets = new Set(groupIds)
    if (!targets.size || !current.groups.some((group) => targets.has(group.id))) return
    pushUndoSnapshot(current)
    set((state) => {
      const nodeIds = new Set<string>()
      for (const group of state.groups) {
        if (!targets.has(group.id)) continue
        group.nodeIds.forEach((nodeId) => nodeIds.add(nodeId))
      }
      for (const node of state.nodes) {
        if (nodeIds.has(node.id)) delete node.groupId
      }
      state.groups = state.groups.filter((candidate) => !targets.has(candidate.id))
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  deleteGroup: (groupId, deleteNodes = false) => {
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing) return
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      const nodeIds = new Set(group.nodeIds)
      if (deleteNodes) {
        const next = removeNodes(state.nodes, state.edges, Array.from(nodeIds))
        state.nodes = next.nodes
        state.edges = next.edges
        state.selectedNodeIds = state.selectedNodeIds.filter((nodeId) => !nodeIds.has(nodeId))
      } else {
        for (const node of state.nodes) {
          if (nodeIds.has(node.id)) delete node.groupId
        }
      }
      state.groups = state.groups.filter((candidate) => candidate.id !== groupId)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  moveNodeToGroup: (nodeId, groupId) => {
    const id = String(groupId || '').trim()
    if (!id) return
    const current = get()
    const sourceNode = current.nodes.find((candidate) => candidate.id === nodeId)
    const targetGroup = current.groups.find((candidate) => candidate.id === id)
    if (!sourceNode || !targetGroup || sourceNode.categoryId !== targetGroup.categoryId) return
    pushUndoSnapshot(current)
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      const group = state.groups.find((candidate) => candidate.id === id)
      if (!node || !group || node.categoryId !== group.categoryId) return
      for (const candidate of state.groups) {
        candidate.nodeIds = candidate.nodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId)
      }
      node.groupId = group.id
      if (!group.nodeIds.includes(nodeId)) group.nodeIds.push(nodeId)
      group.updatedAt = Date.now()
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  removeNodeFromGroup: (nodeId) => {
    pushUndoSnapshot(get())
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node?.groupId) return
      for (const group of state.groups) {
        group.nodeIds = group.nodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId)
      }
      delete node.groupId
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  reorderGroup: (categoryId, activeGroupId, overGroupId) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id) || activeGroupId === overGroupId) return
    pushUndoSnapshot(get())
    set((state) => {
      const categoryGroups = state.groups.filter((group) => group.categoryId === id)
      const activeIndex = categoryGroups.findIndex((group) => group.id === activeGroupId)
      const overIndex = categoryGroups.findIndex((group) => group.id === overGroupId)
      if (activeIndex < 0 || overIndex < 0) return
      const reordered = [...categoryGroups]
      const [active] = reordered.splice(activeIndex, 1)
      if (!active) return
      reordered.splice(overIndex, 0, active)
      const queue = [...reordered]
      state.groups = state.groups.map((group) => group.categoryId === id ? queue.shift() || group : group)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  rollbackHistory: (nodeId, resultId) => {
    set((state) => {
      const nextNodes = rollbackNodeHistory(state.nodes, nodeId, resultId)
      if (nextNodes === state.nodes) return
      state.nodes = nextNodes
      bumpPersistRevision(state)
    })
  },
  readSnapshot: () => {
    const state = get()
    return {
      nodes: state.nodes,
      edges: state.edges,
      groups: state.groups,
      selectedNodeIds: state.selectedNodeIds,
    }
  },
	restoreSnapshot: (snapshot) => {
	    const normalized = normalizeStoreSnapshot(snapshot)
    clearHistory()
	    set({
      isReady: true,
      persistRevision: get().persistRevision,
	      nodes: normalized.nodes,
      edges: normalized.edges,
      groups: normalized.groups,
      selectedNodeIds: normalized.selectedNodeIds,
      pendingConnectionSourceId: '',
      canvasZoom: 1,
      canvasOffset: { x: 0, y: 0 },
      ...getHistoryFlags(),
    })
  },
}))))
