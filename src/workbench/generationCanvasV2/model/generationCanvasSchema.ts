import { z } from 'zod'
import { GENERATION_NODE_KINDS } from './generationNodeKinds'

export const generationNodeKindSchema = z.enum(GENERATION_NODE_KINDS)

export const generationNodeStatusSchema = z.enum(['idle', 'queued', 'running', 'success', 'error'])
export const generationNodeTaskKindSchema = z.enum(['text', 'image', 'video', 'workflow', 'asset', 'unknown'])
export const generationNodeRunStatusSchema = z.enum(['queued', 'running', 'success', 'error', 'cancelled'])

export const generationNodeProgressSchema = z.object({
  runId: z.string().optional(),
  taskId: z.string().optional(),
  taskKind: generationNodeTaskKindSchema.optional(),
  phase: z.string().optional(),
  message: z.string().optional(),
  percent: z.number().optional(),
  updatedAt: z.number(),
})

export const generationNodeResultSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['image', 'video', 'text']),
  url: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  text: z.string().optional(),
  model: z.string().optional(),
  durationSeconds: z.number().optional(),
  taskId: z.string().optional(),
  taskKind: generationNodeTaskKindSchema.optional(),
  assetId: z.string().optional(),
  assetRefId: z.string().optional(),
  raw: z.unknown().optional(),
  createdAt: z.number(),
})

export const generationNodeRunRecordSchema = z.object({
  id: z.string().min(1),
  status: generationNodeRunStatusSchema,
  taskId: z.string().optional(),
  taskKind: generationNodeTaskKindSchema.optional(),
  assetId: z.string().optional(),
  assetRefId: z.string().optional(),
  progress: generationNodeProgressSchema.optional(),
  resultId: z.string().optional(),
  error: z.string().optional(),
  raw: z.unknown().optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional(),
  durationSeconds: z.number().optional(),
})

export const generationCanvasNodeSchema = z.object({
  id: z.string().min(1),
  kind: generationNodeKindSchema,
  title: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  size: z.object({
    width: z.number(),
    height: z.number(),
  }).optional(),
  prompt: z.string().optional(),
  references: z.array(z.string()).optional(),
  result: generationNodeResultSchema.optional(),
  history: z.array(generationNodeResultSchema).optional(),
  progress: generationNodeProgressSchema.optional(),
  runs: z.array(generationNodeRunRecordSchema).optional(),
  status: generationNodeStatusSchema.optional(),
  error: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  categoryId: z.string().optional(),
})

export const generationCanvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  mode: z.enum([
    'reference',
    'first_frame',
    'last_frame',
    'style_ref',
    'character_ref',
    'composition_ref',
  ]).optional(),
})

export const generationCanvasSnapshotSchema = z.object({
  nodes: z.array(generationCanvasNodeSchema),
  edges: z.array(generationCanvasEdgeSchema),
  selectedNodeIds: z.array(z.string()),
})
