// 能力核 · 接入 Claude Code 的 MCP 配置读写（见 docs/plan/2026-06-21-connect-assistant-card.md）。
//
// 「一键接入」就靠这一层：算出 nomi-mcp.mjs 的绝对路径 → 把 { command, args } 合并进用户的
// Claude Code 全局配置 ~/.claude.json 的 mcpServers.nomi。**只写这一个固定文件**（非任意路径写，安全）；
// 写前自动备份；**合并而非覆盖**（保留用户已有的其它 MCP server，如 cocos-creator）。
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readToken } from './security'

const SERVER_NAME = 'nomi'

function claudeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json')
}

/** nomi MCP server 在 ~/.claude.json 里的条目。dev 下脚本在 repo；打包入口是后续切片。 */
function mcpServerEntry(): { command: string; args: string[] } {
  const script = path.join(app.getAppPath(), 'scripts', 'nomi-mcp.mjs')
  return { command: 'node', args: [script] }
}

function readClaudeConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(claudeConfigPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function isInstalled(config: Record<string, unknown>): boolean {
  const servers = config.mcpServers
  return Boolean(servers && typeof servers === 'object' && (servers as Record<string, unknown>)[SERVER_NAME])
}

export type McpInfo = {
  tokenReady: boolean
  rpcRunning: boolean
  installed: boolean
  configPath: string
  /** 给「复制配置」用的、拼好的 mcpServers 片段（带 nomi 条目）。 */
  snippet: string
  server: { command: string; args: string[] }
}

/** 读接入状态 + 配置片段。rpcPort 由调用方（appIntegration）传入（它持有 RPC handle）。 */
export function readMcpInfo(rpcPort: number | null): McpInfo {
  const config = readClaudeConfig()
  const server = mcpServerEntry()
  return {
    tokenReady: readToken() !== null,
    rpcRunning: typeof rpcPort === 'number' && rpcPort > 0,
    installed: isInstalled(config),
    configPath: claudeConfigPath(),
    snippet: JSON.stringify({ mcpServers: { [SERVER_NAME]: server } }, null, 2),
    server,
  }
}

/**
 * 一键写入：备份 → 合并 mcpServers.nomi（保留其它 server）→ 原子写回。
 * 备份固定名 ~/.claude.json.nomi-backup（每次覆盖；目的是「写坏了能回退一版」，不做历史堆积）。
 */
export function installMcp(): { ok: boolean; configPath: string; backupPath: string | null } {
  const target = claudeConfigPath()
  let backupPath: string | null = null
  if (fs.existsSync(target)) {
    backupPath = `${target}.nomi-backup`
    fs.copyFileSync(target, backupPath)
  }
  const config = readClaudeConfig()
  const servers = (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
    ? (config.mcpServers as Record<string, unknown>)
    : {}) as Record<string, unknown>
  servers[SERVER_NAME] = mcpServerEntry()
  config.mcpServers = servers
  // 原子写：先写临时文件再 rename，避免写一半把用户配置写坏。
  const tmp = `${target}.nomi-tmp`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
  fs.renameSync(tmp, target)
  return { ok: true, configPath: target, backupPath }
}

/** 撤销接入：删 mcpServers.nomi（不碰其它 server），写回。文件不存在/没装就当成功。 */
export function uninstallMcp(): { ok: boolean } {
  const target = claudeConfigPath()
  if (!fs.existsSync(target)) return { ok: true }
  const config = readClaudeConfig()
  const servers = config.mcpServers as Record<string, unknown> | undefined
  if (servers && typeof servers === 'object' && servers[SERVER_NAME]) {
    delete servers[SERVER_NAME]
    config.mcpServers = servers
    const tmp = `${target}.nomi-tmp`
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
    fs.renameSync(tmp, target)
  }
  return { ok: true }
}
