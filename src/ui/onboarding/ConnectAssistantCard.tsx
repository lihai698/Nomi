/**
 * 接入 AI 编程助手卡（见 docs/plan/2026-06-21-connect-assistant-card.md）。
 *
 * 一键把 Nomi 接进 Claude Code 的 MCP——用户不读配置、不找路径、不学命令。
 * 复用 FoldableModelCard 折叠语言（与供应商接入卡同一套，P1/P4）。
 * 主操作「一键接入」= 写 ~/.claude.json 的 mcpServers.nomi（合并 + 备份，主进程 mcpConfig）。
 * 兜底：复制配置（给 Codex/Cursor/手动）；撤销接入（删条目）。
 */
import React from 'react'
import { IconTerminal2, IconPlugConnected, IconCopy, IconCheck, IconCircleCheck, IconExternalLink } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { FoldableModelCard } from './FoldableModelCard'

const GUIDE_URL = 'https://github.com/aqm857886159/Nomi/blob/main/docs/guide/capability-core-cli-mcp.md'
const SAY_EXAMPLE = '在 Nomi 新建项目「咖啡广告」，拆 3 个镜头加到画布，用我的图模型把第一个生成出来。'

type McpInfo = {
  tokenReady: boolean
  rpcRunning: boolean
  installed: boolean
  configPath: string
  snippet: string
  server: { command: string; args: string[] }
}

export function ConnectAssistantCard(): JSX.Element | null {
  const [info, setInfo] = React.useState<McpInfo | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState('')

  const capability = getDesktopBridge()?.capability

  const refresh = React.useCallback(() => {
    if (!capability?.mcpInfo) return
    try {
      setInfo(capability.mcpInfo())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [capability])

  React.useEffect(() => { refresh() }, [refresh])

  // 老 preload（无 capability.mcpInfo）：整卡不显，避免坏入口。
  if (!capability?.mcpInfo || !info) return null

  const handleInstall = () => {
    if (!capability.installMcp) return
    setBusy(true)
    setError('')
    try {
      capability.installMcp()
      refresh()
      toast('已接入 Claude Code，重启后生效', 'success')
    } catch (e) {
      setError(`接入失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleUninstall = () => {
    if (!capability.uninstallMcp) return
    setBusy(true)
    setError('')
    try {
      capability.uninstallMcp()
      refresh()
      toast('已撤销接入', 'success')
    } catch (e) {
      setError(`撤销失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(info.snippet).then(() => {
      setCopied(true)
      toast('配置已复制', 'success')
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  const statusLabel = info.installed ? '已接入' : info.tokenReady ? '就绪' : '未就绪'

  return (
    <FoldableModelCard
      glyph={<IconTerminal2 size={16} stroke={1.6} />}
      glyphTone="ink"
      name="接入 AI 编程助手"
      subtitle="让 Claude Code 帮你建项目、出图"
      status={info.installed || info.tokenReady ? 'ok' : 'todo'}
      statusLabel={statusLabel}
      defaultExpanded={false}
    >
      {!info.tokenReady ? (
        <div className="text-caption text-nomi-ink-60 leading-relaxed">
          凭证还没生成——重启 Nomi 一次即可（启动时自动生成）。
        </div>
      ) : info.installed ? (
        <>
          <div className="flex items-start gap-2 rounded-nomi-sm bg-[var(--workbench-success-soft)] px-3 py-2.5">
            <IconCircleCheck size={17} className="shrink-0 mt-0.5 text-workbench-success" />
            <div className="min-w-0">
              <div className="text-body-sm font-semibold text-nomi-ink">已写入 Claude Code 配置</div>
              <div className="text-caption text-nomi-ink-60 mt-0.5">重启 Claude Code 后生效。</div>
            </div>
          </div>
          <div className="text-caption text-nomi-ink-40">现在可以对它说：</div>
          <div className="text-body-sm text-nomi-ink-80 leading-relaxed rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2.5">
            「{SAY_EXAMPLE}」
          </div>
          <button
            type="button"
            onClick={handleUninstall}
            disabled={busy}
            className="self-start text-caption text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50"
          >
            撤销接入
          </button>
        </>
      ) : (
        <>
          <div className="text-caption text-nomi-ink-60 leading-relaxed">
            一键把 Nomi 接进 Claude Code——之后你一句话，它就能在 Nomi 里建项目、拆镜头、用你配好的模型真出图。
          </div>
          <button
            type="button"
            onClick={handleInstall}
            disabled={busy}
            className={cn(
              'w-full h-9 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
              'text-body-sm font-semibold inline-flex items-center justify-center gap-1.5',
              'hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <IconPlugConnected size={15} stroke={1.8} />一键接入 Claude Code
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                'flex-1 h-8 rounded-nomi-sm border border-nomi-line text-nomi-ink-60',
                'text-caption inline-flex items-center justify-center gap-1.5 hover:border-nomi-ink-20',
              )}
            >
              {copied ? <IconCheck size={14} stroke={1.8} /> : <IconCopy size={14} stroke={1.6} />}
              {copied ? '已复制' : '复制配置'}
            </button>
            <button
              type="button"
              onClick={() => window.open(GUIDE_URL, '_blank', 'noopener')}
              className="h-8 px-1 text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:text-nomi-accent"
            >
              看用法<IconExternalLink size={13} stroke={1.6} />
            </button>
          </div>
          <div className="text-micro text-nomi-ink-30">用 Codex / Cursor？点「复制配置」粘进它们的 MCP 设置即可。</div>
        </>
      )}

      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}
    </FoldableModelCard>
  )
}
