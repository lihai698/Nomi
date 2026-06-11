import { connectNodes, disconnectEdge, removeNodes } from '../model/graphOps'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import type { GenerationCanvasEdge, NodeGroup } from '../model/generationCanvasTypes'
import { createGroupId } from './canvasIds'
import { bumpPersistRevision, isCategoryId, shouldPersistCanvasMutation } from './canvasGuards'
import { getHistoryFlags, pushUndoSnapshot } from './canvasHistory'
import type { CanvasGraphActions, CanvasSliceCreator } from './canvasStoreTypes'

export const createCanvasGraphActions: CanvasSliceCreator<CanvasGraphActions> = (set, get) => ({
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
})
