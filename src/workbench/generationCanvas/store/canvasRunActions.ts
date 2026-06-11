import { rollbackNodeHistory } from '../model/graphOps'
import type { GenerationNodeRunRecord } from '../model/generationCanvasTypes'
import { createRunId } from './canvasIds'
import { bumpPersistRevision } from './canvasGuards'
import { createProgress, getResultTaskKind, getRunDurationSeconds, mergeRunRecord } from './runRecordHelpers'
import type { CanvasRunActions, CanvasSliceCreator } from './canvasStoreTypes'

export const createCanvasRunActions: CanvasSliceCreator<CanvasRunActions> = (set) => ({
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
  rollbackHistory: (nodeId, resultId) => {
    set((state) => {
      const nextNodes = rollbackNodeHistory(state.nodes, nodeId, resultId)
      if (nextNodes === state.nodes) return
      state.nodes = nextNodes
      bumpPersistRevision(state)
    })
  },
})
