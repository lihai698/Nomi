// 画布快照归一化 + 种子节点。从 generationCanvasStore.ts 抽出。
// 注意：这是 store 专用的深度归一化（过滤未知 kind、position 兜底、groups 走 zod、edges 校验端点），
// 与 workbenchPersistence.ts 的轻量直通版 normalizeGenerationCanvasSnapshot 行为不同，故改名 normalizeStoreSnapshot。
import { createGenerationNode } from '../model/graphOps'
import { isGenerationNodeKind } from '../model/generationNodeKinds'
import { nodeGroupSchema } from '../model/generationCanvasSchema'
import { isCategoryId } from './canvasGuards'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationCanvasSnapshot,
  NodeGroup,
} from '../model/generationCanvasTypes'

export const seedNodes = [
  createGenerationNode({
    id: 'gen-v2-text-1',
    kind: 'text',
    title: '剧本片段',
    x: 96,
    y: 360,
    prompt: '写下镜头、角色或画面提示词。',
  }),
  createGenerationNode({
    id: 'gen-v2-image-1',
    kind: 'image',
    title: '关键画面',
    x: 440,
    y: 380,
    prompt: '',
  }),
]

export function normalizeStoreSnapshot(input: unknown): GenerationCanvasSnapshot {
  if (!input || typeof input !== 'object') {
    return {
      nodes: seedNodes,
      edges: [{ id: 'edge-gen-v2-text-1-gen-v2-image-1', source: 'gen-v2-text-1', target: 'gen-v2-image-1' }],
      groups: [],
      selectedNodeIds: [],
    }
  }
  const raw = input as Record<string, unknown>
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.flatMap((item): GenerationCanvasNode[] => {
        if (!item || typeof item !== 'object') return []
        const node = item as Record<string, unknown>
        const id = typeof node.id === 'string' ? node.id.trim() : ''
        const kind = isGenerationNodeKind(node.kind) ? node.kind : null
        const positionRaw = node.position && typeof node.position === 'object' ? node.position as Record<string, unknown> : {}
        const x = typeof positionRaw.x === 'number' && Number.isFinite(positionRaw.x) ? positionRaw.x : 0
        const y = typeof positionRaw.y === 'number' && Number.isFinite(positionRaw.y) ? positionRaw.y : 0
        if (!id || !kind) return []
        const rawCategoryId = typeof node.categoryId === 'string' ? node.categoryId.trim() : undefined
        const categoryId = isCategoryId(rawCategoryId) ? rawCategoryId : undefined
        const { categoryId: _discardedCategoryId, ...nodeWithoutCategoryId } = node
        const normalizedNode: Omit<GenerationCanvasNode, 'categoryId'> = {
          ...(nodeWithoutCategoryId as Omit<GenerationCanvasNode, 'categoryId'>),
          id,
          kind,
          title: typeof node.title === 'string' ? node.title : id,
          position: { x, y },
        }
        return [categoryId ? { ...normalizedNode, categoryId } : normalizedNode]
      })
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(raw.edges)
    ? raw.edges.flatMap((item): GenerationCanvasEdge[] => {
        if (!item || typeof item !== 'object') return []
        const edge = item as Record<string, unknown>
        const id = typeof edge.id === 'string' ? edge.id.trim() : ''
        const source = typeof edge.source === 'string' ? edge.source.trim() : ''
        const target = typeof edge.target === 'string' ? edge.target.trim() : ''
        if (!id || !source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return []
        return [{ ...(edge as GenerationCanvasEdge), id, source, target }]
      })
    : []
  const selectedNodeIds = Array.isArray(raw.selectedNodeIds)
    ? raw.selectedNodeIds.filter((id): id is string => typeof id === 'string' && nodeIds.has(id))
    : []
  const groups = Array.isArray(raw.groups)
    ? raw.groups.flatMap((group): NodeGroup[] => {
        const parsed = nodeGroupSchema.safeParse(group)
        if (!parsed.success) return []
        return [{
          ...parsed.data,
          nodeIds: Array.from(new Set(parsed.data.nodeIds.filter((id) => nodeIds.has(id)))),
        }]
      })
    : []
  return {
    nodes,
    edges,
    groups,
    selectedNodeIds,
  }
}
