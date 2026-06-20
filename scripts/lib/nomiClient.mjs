// 能力核 · 传输客户端（CLI 与 MCP server 共用，单一真相源 P1）。
// 纯 node：探测运行中的 Nomi（~/.nomi/capability-core/instance.json，pid 存活）→ 走 RPC（A 模式）；
// 没开 → spawn 无窗口 Electron host（B 模式）。鉴权：每次带 ~/.nomi/capability-core/token。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export function capabilityCoreDir() {
  const configured = String(process.env.NOMI_CAPABILITY_DIR || '').trim()
  return configured || path.join(os.homedir(), '.nomi', 'capability-core')
}

export function readToken() {
  try {
    return fs.readFileSync(path.join(capabilityCoreDir(), 'token'), 'utf8').trim()
  } catch {
    return ''
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export function readLiveInstance() {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(capabilityCoreDir(), 'instance.json'), 'utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null
  if (!isAlive(parsed.pid)) return null
  return parsed
}

async function callViaRpc(instance, token, method, params) {
  const res = await fetch(`http://127.0.0.1:${instance.port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, params }),
  })
  const body = await res.json()
  if (!body.ok) throw new Error(body.error || `RPC ${res.status}`)
  return body.result
}

function callViaHost(token, method, params) {
  return new Promise((resolve, reject) => {
    let electronBinary
    try {
      electronBinary = require('electron')
    } catch {
      reject(new Error('找不到 electron 可执行文件（dev 用；打包版 CLI 走应用内置 Electron，后续切片）'))
      return
    }
    const hostScript = path.join(repoRoot, 'dist-electron', 'capabilityCore', 'host.js')
    if (!fs.existsSync(hostScript)) {
      reject(new Error(`headless host 未构建：${hostScript}（先 pnpm run build:electron）`))
      return
    }
    const child = spawn(electronBinary, [hostScript, '--cmd', JSON.stringify({ token, method, params })], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('exit', () => {
      try {
        const match = stdout.trim().match(/\{[\s\S]*\}$/)
        const body = JSON.parse(match ? match[0] : stdout)
        if (!body.ok) reject(new Error(body.error || 'host 失败'))
        else resolve(body.result)
      } catch {
        reject(new Error(`host 无有效响应。stdout=${stdout.slice(0, 400)} stderr=${stderr.slice(0, 400)}`))
      }
    })
  })
}

/** 调一次能力核方法：app 开着→RPC，关着→headless host。无 token 抛清晰错误。 */
export async function invoke(method, params) {
  const token = readToken()
  if (!token) throw new Error('未找到 token（先启动一次 Nomi 生成 token，路径 ~/.nomi/capability-core/token）')
  const instance = readLiveInstance()
  if (instance) return callViaRpc(instance, token, method, params)
  return callViaHost(token, method, params)
}
