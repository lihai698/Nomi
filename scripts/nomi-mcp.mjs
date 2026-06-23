#!/usr/bin/env node
// 能力核 · MCP server（见 docs/plan/2026-06-20-capability-core-headless-exposure.md §S7）。
//
// 手搓 stdio JSON-RPC 2.0（newline-delimited，MCP stdio transport 规范；协议形状经 Context7 核对 R5），
// 不引 @modelcontextprotocol/sdk 依赖（P1 极简）。把能力核暴露成 MCP 工具，供 Claude Code / Codex / Cursor
// 配置后实时驱动 Nomi。传输底座复用 scripts/lib/nomiClient.mjs（与 CLI 同一份 = P1）。
//
// 在 Claude Code 里配置（~/.claude.json 或项目 .mcp.json）：
//   { "mcpServers": { "nomi": { "command": "node", "args": ["<repo>/scripts/nomi-mcp.mjs"] } } }
import readline from 'node:readline'
import { invoke, readLiveInstance } from './lib/nomiClient.mjs'

const PROTOCOL_VERSION = '2025-11-25'

// 客户端能力（initialize 时捕获）。elicitation = 客户端能代我们向真人弹确认对话框（MCP 规范 2025-06-18）。
// 用于「Nomi 没开时，让用户在 Claude 这一侧确认付费生成」——模型自己无法应答 elicitation（只有真人/用户
// 自配的 Hook 能答），故付费铁律「真人确认才授权」不破。
let clientSupportsElicitation = false

// 服务端→客户端请求（如 elicitation/create）：手搓 JSON-RPC 需自管 id 与 pending，等客户端回响应。
let serverReqSeq = 0
const pendingServerReqs = new Map()

function sendServerRequest(method, params, timeoutMs = 300000) {
  const id = `srv-${(serverReqSeq += 1)}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingServerReqs.delete(id)
      reject(new Error('客户端无响应（确认超时）'))
    }, timeoutMs)
    pendingServerReqs.set(id, { resolve, reject, timer })
    send({ jsonrpc: '2.0', id, method, params })
  })
}

/**
 * 让客户端（Claude Code）向真人弹一个「确认花费」对话框（boolean）。
 * 不支持 elicitation 的客户端返回 { supported:false }；支持则返回 { supported:true, confirmed:bool }。
 * 规范禁止用 elicitation 索取密码/密钥——这里只问「确不确认花钱」，不碰敏感信息。
 */
async function elicitSpendConfirm(text) {
  if (!clientSupportsElicitation) return { supported: false }
  try {
    const res = await sendServerRequest('elicitation/create', {
      message: text,
      requestedSchema: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', title: '确认生成', description: '确认后将消耗模型额度生成；取消则不生成、不花费。' },
        },
        required: ['confirm'],
      },
    })
    // 三态：accept(带 content) / decline / cancel。只在明确 accept 且未显式 confirm=false 时放行。
    const confirmed = res?.action === 'accept' && res?.content?.confirm !== false
    return { supported: true, confirmed }
  } catch {
    // 超时/异常 → 当作未确认（不死等、不偷偷花钱）。
    return { supported: true, confirmed: false }
  }
}

// 工具定义：name → { description, inputSchema(JSON Schema), method(能力核方法), build(args→params) }。
const TOOLS = [
  {
    name: 'nomi_list_projects',
    description: '列出本机 Nomi 的所有项目（id / 名称 / 更新时间）。',
    inputSchema: { type: 'object', properties: {} },
    method: 'project.list',
    build: () => ({}),
  },
  {
    name: 'nomi_create_project',
    description: '新建一个空白 Nomi 项目，返回项目 id。',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: '项目名（可选）' } } },
    method: 'project.create',
    build: (a) => (a.name ? { name: a.name } : {}),
  },
  {
    name: 'nomi_list_models',
    description: '列出 Nomi 已接入且可用的生成模型（vendor / modelKey / 能力 kind / 名称），用于选型。',
    inputSchema: { type: 'object', properties: {} },
    method: 'models.list',
    build: () => ({}),
  },
  {
    name: 'nomi_read_canvas',
    description: '读取某项目画布的节点与连线（精简视图，用于据此决策）。',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
    method: 'canvas.read',
    build: (a) => ({ projectId: a.projectId }),
  },
  {
    name: 'nomi_add_nodes',
    description: '往项目画布批量加节点（镜头/文本/图片/视频等）。返回新建节点 id。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', description: 'text / image / video / shot / character / scene / audio 等' },
              title: { type: 'string' },
              prompt: { type: 'string' },
            },
          },
        },
      },
      required: ['projectId', 'nodes'],
    },
    method: 'canvas.addNodes',
    build: (a) => ({ projectId: a.projectId, nodes: a.nodes || [] }),
  },
  {
    name: 'nomi_connect_nodes',
    description: '连线（参考关系）。connections=[{source,target,mode?}]，mode 缺省 reference。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        connections: {
          type: 'array',
          items: { type: 'object', properties: { source: { type: 'string' }, target: { type: 'string' }, mode: { type: 'string' } }, required: ['source', 'target'] },
        },
      },
      required: ['projectId', 'connections'],
    },
    method: 'canvas.connect',
    build: (a) => ({ projectId: a.projectId, connections: a.connections || [] }),
  },
  {
    name: 'nomi_set_node_prompt',
    description: '改某节点的提示词（可选改标题）。',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, nodeId: { type: 'string' }, prompt: { type: 'string' }, title: { type: 'string' } },
      required: ['projectId', 'nodeId', 'prompt'],
    },
    method: 'canvas.setPrompt',
    build: (a) => ({ projectId: a.projectId, nodeId: a.nodeId, prompt: a.prompt, title: a.title }),
  },
  {
    name: 'nomi_delete_nodes',
    description: '删除节点及其关联连线。',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' } } }, required: ['projectId', 'nodeIds'] },
    method: 'canvas.deleteNodes',
    build: (a) => ({ projectId: a.projectId, nodeIds: a.nodeIds || [] }),
  },
  {
    name: 'nomi_generate',
    description: '触发一次生成（用 Nomi 的 archetype 正确组装参数 + 落资产回节点）。会花用户额度。intent=image/video/text/audio。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        vendor: { type: 'string' },
        modelKey: { type: 'string' },
        intent: { type: 'string', enum: ['image', 'video', 'text', 'audio'] },
        prompt: { type: 'string' },
        nodeId: { type: 'string', description: '在既有节点上生成（可选）' },
        references: { type: 'array', items: { type: 'string' }, description: '参考图 URL（可选）' },
      },
      required: ['projectId', 'vendor', 'modelKey', 'intent', 'prompt'],
    },
    method: 'generate',
    build: (a) => ({ projectId: a.projectId, vendor: a.vendor, modelKey: a.modelKey, intent: a.intent, prompt: a.prompt, nodeId: a.nodeId, references: a.references }),
  },
]

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

const INTENT_LABEL = { image: '一张画面', video: '一段视频', audio: '一段音频', text: '一段文本' }

/** 人话花费提示（给确认对话框看）：产物类型 + 模型 + 提示词截断。不显金额（守卫不依赖金额）。 */
function describeSpend(args) {
  const what = INTENT_LABEL[String(args?.intent || '')] || '一个素材'
  const model = [args?.vendor, args?.modelKey].filter(Boolean).join(' · ') || '默认模型'
  const prompt = typeof args?.prompt === 'string' && args.prompt.trim() ? `「${args.prompt.trim().slice(0, 50)}${args.prompt.length > 50 ? '…' : ''}」` : ''
  return `即将用 ${model} 生成${what}${prompt ? ' ' + prompt : ''}，将消耗模型额度。`
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(message) {
  const { id, method, params } = message
  // 通知（无 id）不回响应。
  if (id === undefined || id === null) return

  if (method === 'initialize') {
    // 记下客户端是否支持 elicitation（能代我们向真人弹确认对话框）。
    clientSupportsElicitation = Boolean(params?.capabilities?.elicitation)
    // 协议版本回显客户端请求的版本（兼容性根因 R5 实证）：我们只用 tools + elicitation(能力门控降级)，
    // 这俩跨各修订都在，故回显客户端所讲版本最大化兼容。硬回我们偏好的版本会让只讲更老协议的客户端
    // 按规范 SHOULD 断开 → 连基础工具都用不了。客户端没给版本才回退我们的默认。
    const negotiatedVersion = typeof params?.protocolVersion === 'string' && params.protocolVersion ? params.protocolVersion : PROTOCOL_VERSION
    reply(id, {
      protocolVersion: negotiatedVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'nomi-capability-core', version: '0.1.0' },
      instructions: '用 nomi_* 工具在本机驱动 Nomi：列项目/模型、建项目、读画布、加节点/连线/改提示词、触发生成。生成会花用户额度。',
    })
    return
  }
  if (method === 'tools/list') {
    reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    return
  }
  if (method === 'tools/call') {
    const name = params?.name
    const tool = TOOL_BY_NAME.get(name)
    if (!tool) {
      replyError(id, -32602, `未知工具: ${name}`)
      return
    }
    const args = params?.arguments || {}
    try {
      // 付费生成 + Nomi 没开（B 模式，无应用内确认卡可弹）→ 在 Claude 这一侧弹 elicitation 让真人确认。
      // 真人确认才以本次调用 env 授权 headless host 铸令牌（NOMI_LOOP_SPEND_OK）；enforcement 仍在主进程硬闸。
      // app 开着（A 模式）则照常走——由应用内确认卡处理，不在此弹（用户人在 Nomi 边上）。
      if (tool.name === 'nomi_generate' && !readLiveInstance()) {
        const costHint = describeSpend(args)
        const confirm = await elicitSpendConfirm(`Nomi 未打开。${costHint}\n确认现在生成吗？`)
        if (!confirm.supported) {
          reply(id, {
            content: [{ type: 'text', text: '已暂停：Nomi 未打开，且当前客户端不支持弹确认。请打开 Nomi 后再触发生成（或在 Nomi 里确认）。节点/提示词若已通过其它工具写入则已保存。' }],
            isError: true,
          })
          return
        }
        if (!confirm.confirmed) {
          reply(id, { content: [{ type: 'text', text: '已取消：你未确认这次付费生成，未生成、未消耗额度。' }], isError: true })
          return
        }
        const result = await invoke(tool.method, tool.build(args), { spawnEnv: { NOMI_LOOP_SPEND_OK: '1' } })
        reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
        return
      }
      const result = await invoke(tool.method, tool.build(args))
      reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
    } catch (error) {
      // 工具执行失败用 isError 返回（让模型看到错误而非协议级 error）。
      reply(id, { content: [{ type: 'text', text: `错误：${error instanceof Error ? error.message : String(error)}` }], isError: true })
    }
    return
  }
  if (method === 'ping') {
    reply(id, {})
    return
  }
  replyError(id, -32601, `未实现的方法: ${method}`)
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    return // 非 JSON 行忽略（不崩）
  }
  // 客户端对「服务端→客户端请求」（如 elicitation/create）的响应：按 id 路由到 pending，不当新请求处理。
  if (message && message.method === undefined && message.id != null && pendingServerReqs.has(message.id)) {
    const pending = pendingServerReqs.get(message.id)
    pendingServerReqs.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(message.error.message || '客户端返回错误'))
    else pending.resolve(message.result)
    return
  }
  void handle(message).catch((error) => {
    if (message && message.id != null) replyError(message.id, -32603, error instanceof Error ? error.message : String(error))
  })
})
