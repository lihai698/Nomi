import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { removeNodes } from '../model/graphOps'
import { bumpPersistRevision } from './canvasGuards'
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
import { normalizeStoreSnapshot, seedNodes } from './canvasSnapshotNormalizer'
import type { GenerationCanvasState } from './canvasStoreTypes'
import { createCanvasNodeActions } from './canvasNodeActions'
import { createCanvasGraphActions } from './canvasGraphActions'
import { createCanvasRunActions } from './canvasRunActions'

export { __resetGenerationCanvasHistoryForTests } from './canvasHistory'

export const useGenerationCanvasStore = create<GenerationCanvasState>()(subscribeWithSelector(immer((set, get, store) => ({
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
  ...createCanvasNodeActions(set, get, store),
  ...createCanvasGraphActions(set, get, store),
  ...createCanvasRunActions(set, get, store),
}))))
