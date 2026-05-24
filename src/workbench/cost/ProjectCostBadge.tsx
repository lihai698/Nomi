import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import { cn } from '../../utils/cn'

type CostSummary = {
  total: number
  count: number
  byProvider: Record<string, number>
  byKind: Record<string, number>
}

const EMPTY_SUMMARY: CostSummary = { total: 0, count: 0, byProvider: {}, byKind: {} }

function formatUsd(value: number): string {
  if (value <= 0) return '$0.00'
  if (value < 0.01) return '<$0.01'
  if (value < 1) return `$${value.toFixed(3)}`
  if (value < 100) return `$${value.toFixed(2)}`
  return `$${Math.round(value)}`
}

/**
 * Phase E Task E10 — Project cost badge.
 *
 * Reads `~/Documents/Nomi Projects/{id}/logs/cost-log.jsonl` via IPC and
 * shows the project's accumulated AI cost estimate. Click to expand a
 * breakdown by provider/kind.
 *
 * The number is explicitly labelled "估算" / "estimate" to set user
 * expectations — actual billing comes from the provider dashboard.
 */
export default function ProjectCostBadge({
  projectId,
  refreshSignal,
}: {
  projectId: string | null | undefined
  /** Bump this to force a re-read (e.g., after a generation completes). */
  refreshSignal?: number
}): JSX.Element | null {
  const [summary, setSummary] = React.useState<CostSummary>(EMPTY_SUMMARY)
  const [expanded, setExpanded] = React.useState(false)

  React.useEffect(() => {
    if (!projectId) {
      setSummary(EMPTY_SUMMARY)
      return
    }
    const desktop = getDesktopBridge()
    if (!desktop?.cost?.projectSummary) return
    try {
      const result = desktop.cost.projectSummary(projectId)
      setSummary(result ?? EMPTY_SUMMARY)
    } catch {
      setSummary(EMPTY_SUMMARY)
    }
  }, [projectId, refreshSignal])

  // Re-poll every 30s while mounted (cheap synchronous IPC).
  React.useEffect(() => {
    if (!projectId) return
    const interval = window.setInterval(() => {
      const desktop = getDesktopBridge()
      if (!desktop?.cost?.projectSummary) return
      try {
        const result = desktop.cost.projectSummary(projectId)
        setSummary(result ?? EMPTY_SUMMARY)
      } catch {
        /* ignore */
      }
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [projectId])

  if (!projectId) return null

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-nomi-sm',
          'border border-nomi-line bg-nomi-paper shadow-nomi-sm',
          'text-[11.5px] text-nomi-ink-80 hover:text-nomi-ink',
          'hover:bg-nomi-bg transition-colors duration-150 cursor-pointer',
        )}
        title={`项目累计 AI 估算费用：${formatUsd(summary.total)}（${summary.count} 次调用）`}
        aria-label="项目费用估算"
      >
        <span aria-hidden="true">💰</span>
        <span className="font-medium">{formatUsd(summary.total)}</span>
        <span className="text-nomi-ink-40">估算</span>
      </button>

      {expanded ? (
        <div
          className={cn(
            'absolute bottom-full right-0 mb-2 z-[120]',
            'min-w-[240px] p-3 rounded-nomi-sm',
            'border border-nomi-line bg-nomi-paper shadow-nomi-md',
            'text-[12px]',
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-nomi-ink">项目费用估算</span>
            <span className="text-nomi-ink-40">{summary.count} 次调用</span>
          </div>
          <div className="text-[16px] font-medium text-nomi-ink mb-3">
            {formatUsd(summary.total)}
            <span className="text-[11px] text-nomi-ink-40 ml-1">USD</span>
          </div>
          {Object.keys(summary.byKind).length > 0 ? (
            <div className="space-y-1 mb-3">
              <div className="text-[10.5px] text-nomi-ink-40 uppercase tracking-wide">按类型</div>
              {Object.entries(summary.byKind).map(([kind, value]) => (
                <div key={kind} className="flex justify-between text-nomi-ink-80">
                  <span>{kind}</span>
                  <span>{formatUsd(value)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {Object.keys(summary.byProvider).length > 0 ? (
            <div className="space-y-1 mb-2">
              <div className="text-[10.5px] text-nomi-ink-40 uppercase tracking-wide">按供应商</div>
              {Object.entries(summary.byProvider).map(([provider, value]) => (
                <div key={provider} className="flex justify-between text-nomi-ink-80">
                  <span>{provider}</span>
                  <span>{formatUsd(value)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-[10.5px] text-nomi-ink-40 leading-snug pt-2 border-t border-nomi-line-soft">
            数字为基于内置价格表的估算，实际账单以供应商为准。
          </p>
        </div>
      ) : null}
    </div>
  )
}
