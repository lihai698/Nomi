import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// nomi-mcp.mjs 的 elicitation 付费确认握手（B 模式：Nomi 没开）。
// 验证手搓双向 JSON-RPC：服务端能发 elicitation/create 给客户端、按 id 路由响应、按确认结果放行/拦截。
// 不触发真实生成——只覆盖 decline / 不支持 两条不调 invoke 的路径。

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const mcpScript = path.join(repoRoot, 'scripts', 'nomi-mcp.mjs')

type RpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown; result?: unknown; error?: unknown }

class McpHarness {
  private child: ChildProcessWithoutNullStreams
  private rl: readline.Interface
  private queue: RpcMessage[] = []
  private waiters: Array<(msg: RpcMessage) => void> = []

  constructor(capDir: string) {
    // 空 NOMI_CAPABILITY_DIR → 无 instance.json → readLiveInstance()=null → B 模式（关着）。
    this.child = spawn('node', [mcpScript], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NOMI_CAPABILITY_DIR: capDir },
    }) as ChildProcessWithoutNullStreams
    this.rl = readline.createInterface({ input: this.child.stdout })
    this.rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let msg: RpcMessage
      try {
        msg = JSON.parse(trimmed)
      } catch {
        return
      }
      const waiter = this.waiters.shift()
      if (waiter) waiter(msg)
      else this.queue.push(msg)
    })
  }

  send(msg: RpcMessage): void {
    this.child.stdin.write(JSON.stringify(msg) + '\n')
  }

  next(timeoutMs = 5000): Promise<RpcMessage> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 MCP 消息超时')), timeoutMs)
      this.waiters.push((msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
    })
  }

  async initialize(elicitation: boolean, protocolVersion = '2025-11-25'): Promise<RpcMessage> {
    this.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion, capabilities: elicitation ? { elicitation: {} } : {} },
    })
    const res = await this.next()
    expect(res.id).toBe(1)
    return res
  }

  dispose(): void {
    this.rl.close()
    this.child.kill('SIGKILL')
  }
}

let harness: McpHarness | null = null
const tempDirs: string[] = []

function emptyCapDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-elicit-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  harness?.dispose()
  harness = null
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('nomi-mcp · 付费 elicitation 握手（B 模式）', () => {
  it('客户端支持 elicitation：generate → 弹确认 → decline → 拦截不生成', async () => {
    harness = new McpHarness(emptyCapDir())
    await harness.initialize(true)
    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'nomi_generate', arguments: { projectId: 'p', vendor: 'apimart', modelKey: 'doubao-seedance-2.0', intent: 'video', prompt: '巷口回头' } },
    })
    // 服务端应先发 elicitation/create 请求给客户端。
    const elicit = await harness.next()
    expect(elicit.method).toBe('elicitation/create')
    expect(typeof elicit.id).toBe('string')
    const params = elicit.params as { message?: string }
    expect(params.message).toContain('Nomi 未打开')
    expect(params.message).toContain('doubao-seedance-2.0')
    // 真人点了取消 → decline。
    harness.send({ jsonrpc: '2.0', id: elicit.id, result: { action: 'decline' } })
    const toolRes = await harness.next()
    expect(toolRes.id).toBe(2)
    const result = toolRes.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('已取消')
  })

  it('握手回显客户端请求的协议版本（兼容只讲老协议的客户端，如 Codex/Cursor 早期）', async () => {
    harness = new McpHarness(emptyCapDir())
    // 老客户端只讲 2025-03-26（elicitation 之前的修订）。
    const res = await harness.initialize(false, '2025-03-26')
    const result = res.result as { protocolVersion?: string }
    expect(result.protocolVersion).toBe('2025-03-26')
  })

  it('客户端不支持 elicitation：generate → 不弹、回可操作错误', async () => {
    harness = new McpHarness(emptyCapDir())
    await harness.initialize(false)
    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'nomi_generate', arguments: { projectId: 'p', vendor: 'apimart', modelKey: 'sora-2', intent: 'video', prompt: 'x' } },
    })
    const toolRes = await harness.next()
    expect(toolRes.id).toBe(2)
    const result = toolRes.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Nomi 未打开')
  })
})
