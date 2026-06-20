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
import { invoke } from './lib/nomiClient.mjs'

const PROTOCOL_VERSION = '2025-11-25'

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
    reply(id, {
      protocolVersion: PROTOCOL_VERSION,
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
    try {
      const result = await invoke(tool.method, tool.build(params?.arguments || {}))
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
  void handle(message).catch((error) => {
    if (message && message.id != null) replyError(message.id, -32603, error instanceof Error ? error.message : String(error))
  })
})
