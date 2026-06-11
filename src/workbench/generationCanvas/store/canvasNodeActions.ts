import { createGenerationNode, removeNodes, upsertNode } from '../model/graphOps'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { CLIPBOARD_OFFSET, createClipboardNodeId, createNodeId } from './canvasIds'
import { bumpPersistRevision, isCategoryId, shouldPersistCanvasMutation } from './canvasGuards'
import { getHistoryFlags, pushUndoSnapshot } from './canvasHistory'
import type { CanvasNodeActions, CanvasSliceCreator } from './canvasStoreTypes'

export const createCanvasNodeActions: CanvasSliceCreator<CanvasNodeActions> = (set, get) => ({
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
})
