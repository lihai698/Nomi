import React from 'react'
import { cn } from '../../../utils/cn'
import { getBuiltinCategoryById } from '../../project/projectCategories'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

type Props = {
  node: GenerationCanvasNode
}

/**
 * Mura 设计标题 pill（spec §6.1）：
 * 深色圆角胶囊，浮在节点左上角，显示分类名 + 自动编号（仅 shots）。
 *
 * 编号算法（E.2C-27 / spec §6.4）：
 * 在 shots 分类内，按 position.y 升序（同 y 时按 id 字典序）排列，
 * 编号 1..N，零填充 2 位。拖动后实时重算。
 * 节点持久化字段 node.shotIndex 由 migration 写入（缓存用），
 * 但 UI 始终以 live 计算为准，避免新建/拖动后过期。
 */
export default function TitlePill({ node }: Props): JSX.Element | null {
  // E.2C-27: live 计算 shotIndex，避免依赖可能过期的持久化字段
  const liveShotIndex = useGenerationCanvasStore((state) => {
    if (node.categoryId !== 'shots') return null
    const shots = state.nodes
      .filter((n) => n.categoryId === 'shots')
      .sort((a, b) => {
        const ay = a.position?.y ?? 0
        const by = b.position?.y ?? 0
        if (ay !== by) return ay - by
        return a.id.localeCompare(b.id)
      })
    const idx = shots.findIndex((n) => n.id === node.id)
    return idx >= 0 ? idx + 1 : null
  })

  const category = node.categoryId ? getBuiltinCategoryById(node.categoryId) : null
  const categoryName = category?.name

  let label: string | null = null
  if (categoryName) {
    if (node.categoryId === 'shots' && typeof liveShotIndex === 'number') {
      label = `${categoryName} ${String(liveShotIndex).padStart(2, '0')}`
    } else {
      label = categoryName
    }
  } else if (node.title) {
    label = node.title
  }

  if (!label) return null

  return (
    <span
      className={cn(
        'generation-canvas-v2-node__title-pill',
        'inline-flex items-center px-2 py-[3px] rounded-md',
        'bg-nomi-ink text-nomi-paper',
        'text-[11px] font-medium leading-none tracking-[0.02em]',
        'pointer-events-none select-none',
        'tabular-nums',
      )}
      aria-label={`分类标签：${label}`}
    >
      {label}
    </span>
  )
}
