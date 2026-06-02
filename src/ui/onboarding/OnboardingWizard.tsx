/**
 * Onboarding Wizard — Apple-style minimal "add a model".
 *
 * User pastes a docs URL + their API key. The agent reads the docs,
 * extracts parameters with evidence, tests one real call, and persists
 * a verified-working catalog entry. UI never surfaces internal terms
 * like "vendor / mapping / endpoint" — those are implementation details
 * (per Design.md "no decorative complexity").
 *
 * Backed by:
 *   nomiDesktop.onboarding.start  → kicks off main-process agent loop
 *   nomiDesktop.onboarding.onEvent(trialId, cb) → streams milestones
 *
 * Auto-commits to catalog on success (the IPC handler does it).
 */
import React from 'react'
import { Stack, Group, Text, PasswordInput, ActionIcon, Anchor } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { DesignButton, DesignModal, DesignTextInput } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'

type Phase = 'input' | 'running' | 'success' | 'error'

type Milestone = {
  id: 'read' | 'kind' | 'identity' | 'fields' | 'test' | 'commit'
  label: string
  status: 'pending' | 'active' | 'done' | 'failed'
}

const INITIAL_MILESTONES: Milestone[] = [
  { id: 'read', label: '读取文档内容', status: 'pending' },
  { id: 'kind', label: '识别类型', status: 'pending' },
  { id: 'identity', label: '识别接口和认证方式', status: 'pending' },
  { id: 'fields', label: '提取参数', status: 'pending' },
  { id: 'test', label: '测试调用', status: 'pending' },
  { id: 'commit', label: '保存到模型库', status: 'pending' },
]

const MILESTONE_BY_TOOL: Record<string, Milestone['id']> = {
  fetch_raw_docs: 'read',
  set_model_kind: 'kind',
  set_vendor_info: 'identity',
  set_fields: 'fields',
  add_field_with_evidence: 'fields',
  set_mapping_request: 'identity',
  set_mapping_response: 'identity',
  execute_test_curl: 'test',
  commit_model: 'commit',
  check_completeness: 'fields',
}

export function OnboardingWizard({ opened, onClose, onCommitted }: {
  opened: boolean
  onClose: () => void
  /** Called once a model is committed to the catalog. */
  onCommitted?: (model: unknown) => void
}): JSX.Element {
  const bridge = getDesktopBridge()
  const [phase, setPhase] = React.useState<Phase>('input')
  // input has two branches: 'manual' is the primary path (BaseURL + key + models,
  // breaks the bootstrap deadlock, works for local/text models); 'docs' is the
  // secondary path (AI reads docs) for image/video models with non-standard APIs.
  const [inputMode, setInputMode] = React.useState<'manual' | 'docs'>('manual')
  const [docsUrl, setDocsUrl] = React.useState('')
  const [userApiKey, setUserApiKey] = React.useState('')
  // manual-form state
  const [vendorName, setVendorName] = React.useState('')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [models, setModels] = React.useState<Array<{ id: string; displayName: string }>>([{ id: '', displayName: '' }])
  const [saving, setSaving] = React.useState(false)
  const [testState, setTestState] = React.useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMessage, setTestMessage] = React.useState('')
  const [milestones, setMilestones] = React.useState<Milestone[]>(INITIAL_MILESTONES)
  const [activeMessage, setActiveMessage] = React.useState('正在阅读文档…')
  const [fieldsCount, setFieldsCount] = React.useState(0)
  const [detectedKind, setDetectedKind] = React.useState<string | null>(null)
  const [resultLabel, setResultLabel] = React.useState('')
  const [errorReason, setErrorReason] = React.useState('')
  const [errorHint, setErrorHint] = React.useState('')
  const [traceJson, setTraceJson] = React.useState<unknown>(null)
  const trialIdRef = React.useRef<string | null>(null)
  const unsubRef = React.useRef<(() => void) | null>(null)

  // Clean up event subscription on unmount.
  React.useEffect(() => {
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
      trialIdRef.current = null
    }
  }, [])

  const resetToInput = React.useCallback(() => {
    setPhase('input')
    setMilestones(INITIAL_MILESTONES)
    setFieldsCount(0)
    setDetectedKind(null)
    setResultLabel('')
    setErrorReason('')
    setErrorHint('')
    setTraceJson(null)
    // Keep credentials (vendorName/baseUrl/userApiKey) so "再添加一个" under the
    // same endpoint is one step; only clear the per-add model rows + test result.
    setModels([{ id: '', displayName: '' }])
    setTestState('idle')
    setTestMessage('')
  }, [])

  const updateModel = React.useCallback((index: number, patch: Partial<{ id: string; displayName: string }>) => {
    setModels(prev => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)))
  }, [])
  const addModelRow = React.useCallback(() => {
    setModels(prev => [...prev, { id: '', displayName: '' }])
  }, [])
  const removeModelRow = React.useCallback((index: number) => {
    setModels(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }, [])

  const handleTestConnection = React.useCallback(async () => {
    if (!bridge?.onboarding?.testConnection) return
    setTestState('testing')
    setTestMessage('')
    const firstModelId = models.find(m => m.id.trim())?.id.trim()
    const res = await bridge.onboarding.testConnection({
      baseUrl: baseUrl.trim(),
      apiKey: userApiKey.trim(),
      modelId: firstModelId,
    })
    if (res.ok) {
      setTestState('ok')
      setTestMessage('连接正常')
    } else {
      setTestState('fail')
      setTestMessage(res.error || '连接失败')
    }
  }, [bridge, baseUrl, userApiKey, models])

  const handleManualSave = React.useCallback(async () => {
    if (!bridge?.onboarding?.manualCommit) {
      setErrorReason('当前环境没有桌面端模块，无法运行。')
      setPhase('error')
      return
    }
    const cleanModels = models
      .map(m => ({ id: m.id.trim(), displayName: m.displayName.trim() || undefined }))
      .filter(m => m.id.length > 0)
    if (cleanModels.length === 0) return
    setSaving(true)
    try {
      const res = await bridge.onboarding.manualCommit({
        vendorName: vendorName.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: userApiKey.trim(),
        models: cleanModels,
      })
      if (res.ok) {
        const n = res.committed?.length ?? cleanModels.length
        setResultLabel(n === 1 ? (res.committed?.[0]?.displayName || cleanModels[0].id) : `${n} 个模型`)
        setPhase('success')
        if (res.committed) onCommitted?.(res.committed)
      } else {
        setErrorReason('没能保存')
        setErrorHint(res.error || '请检查接入地址和 API Key')
        setPhase('error')
      }
    } finally {
      setSaving(false)
    }
  }, [bridge, vendorName, baseUrl, userApiKey, models, onCommitted])

  const handleStart = React.useCallback(async () => {
    if (!bridge?.onboarding) {
      setErrorReason('当前环境没有桌面端模块，无法运行。')
      setPhase('error')
      return
    }
    if (!docsUrl.trim() || !userApiKey.trim()) return
    setPhase('running')
    setMilestones(prev => prev.map(m => m.id === 'read' ? { ...m, status: 'active' } : m))
    setActiveMessage('正在阅读文档…')
    try {
      const { trialId } = await bridge.onboarding.start({ docsUrl: docsUrl.trim(), userApiKey: userApiKey.trim() })
      trialIdRef.current = trialId
      unsubRef.current = bridge.onboarding.onEvent(trialId, ev => handleEvent(ev))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Most common cause: no text model configured to read the docs.
      const isAgentMissing = /Onboarding agent not configured/.test(msg)
      setErrorReason(isAgentMissing ? '还没有配置用来阅读文档的 AI' : '没能启动')
      setErrorHint(isAgentMissing
        ? '请先在「模型设置」里添加一个文本模型（如 GPT、Kimi），它会负责读文档。'
        : msg)
      setPhase('error')
    }
  }, [bridge, docsUrl, userApiKey])

  const handleEvent = React.useCallback((raw: unknown) => {
    const ev = raw as { type: string; [k: string]: unknown }
    if (ev.type === 'tool-call' && typeof ev.toolName === 'string') {
      const milestoneId = MILESTONE_BY_TOOL[ev.toolName]
      if (milestoneId) {
        setMilestones(prev => bumpToActive(prev, milestoneId))
        setActiveMessage(activeMessageFor(milestoneId))
      }
    }
    if (ev.type === 'tool-result' && typeof ev.toolName === 'string') {
      const milestoneId = MILESTONE_BY_TOOL[ev.toolName]
      const result = ev.result as { ok?: boolean; value?: Record<string, unknown> } | undefined
      const ok = result?.ok !== false
      if (milestoneId) {
        setMilestones(prev => markStatus(prev, milestoneId, ok ? 'done' : 'failed'))
      }
      // Side-effects: pick up field count, detected kind from set_fields/set_model_kind results.
      if (ev.toolName === 'set_fields' && ok) {
        const total = Number(result?.value?.totalFields || 0)
        setFieldsCount(total)
      }
      if (ev.toolName === 'set_model_kind' && ok) {
        const kind = result?.value?.kind
        if (typeof kind === 'string') setDetectedKind(kind)
      }
    }
    if (ev.type === 'trial-end') {
      const outcome = (ev as { outcome?: { status?: string; failureReason?: string; draft?: { modelDisplayName?: string; targetKind?: string } } }).outcome
      if (outcome?.draft?.targetKind) setDetectedKind(outcome.draft.targetKind)
      if (outcome?.status === 'success') {
        setResultLabel(outcome.draft?.modelDisplayName || '新模型')
      }
    }
    if (ev.type === 'result') {
      const data = ev as { outcome?: { status?: string; failureReason?: string; draft?: { modelDisplayName?: string } }; committedModel?: unknown }
      if (data.outcome?.status === 'success') {
        setMilestones(prev => markStatus(prev, 'commit', 'done'))
        setResultLabel(data.outcome.draft?.modelDisplayName || resultLabel || '新模型')
        setPhase('success')
        if (data.committedModel) onCommitted?.(data.committedModel)
      } else {
        setErrorReason(failureLabelFor(data.outcome?.failureReason))
        setErrorHint(humanHintFor(data.outcome?.failureReason))
        setTraceJson(data.outcome)
        setPhase('error')
      }
    }
    if (ev.type === 'error') {
      const msg = (ev as { message?: string }).message || '出了点问题'
      setErrorReason('运行过程中出错')
      setErrorHint(msg)
      setPhase('error')
    }
  }, [onCommitted, resultLabel])

  const handleCopyLog = React.useCallback(async () => {
    if (!traceJson) return
    try { await navigator.clipboard.writeText(JSON.stringify(traceJson, null, 2)) } catch { /* ignore */ }
  }, [traceJson])

  const canStart = docsUrl.trim().length > 0 && userApiKey.trim().length > 0 && phase === 'input'
  const baseUrlValid = /^https?:\/\//i.test(baseUrl.trim())
  const hasModelId = models.some(m => m.id.trim().length > 0)
  const canSaveManual = baseUrlValid && userApiKey.trim().length > 0 && hasModelId && !saving

  return (
    <DesignModal
      opened={opened}
      onClose={onClose}
      title="添加一个 AI 模型"
      size={480}
      centered
      closeOnClickOutside={phase !== 'running'}
      closeOnEscape={phase !== 'running'}
    >
      <Stack gap="md">
        <Group justify="flex-end">
          <ProgressDots phase={phase} />
        </Group>

        {phase === 'input' && inputMode === 'manual' && (
          <Stack gap="md">
            <Field label="供应商名称" hint="给这个接入点起个名字，方便你认（可选）">
              <DesignTextInput
                value={vendorName}
                onChange={e => setVendorName(e.currentTarget.value)}
                placeholder="如：本地 Ollama、我的中转站"
                autoFocus
              />
            </Field>
            <Field label="接入地址（BaseURL）" hint="OpenAI 兼容端点，到 /v1 为止">
              <DesignTextInput
                value={baseUrl}
                onChange={e => { setBaseUrl(e.currentTarget.value); setTestState('idle') }}
                placeholder="http://localhost:11434/v1"
                error={baseUrl.trim().length > 0 && !baseUrlValid ? '需以 http:// 或 https:// 开头' : undefined}
              />
            </Field>
            <Field label="你的 API Key" hint="只存在你的电脑上，加密保存（本地模型可随便填）">
              <PasswordInput
                value={userApiKey}
                onChange={e => { setUserApiKey(e.currentTarget.value); setTestState('idle') }}
                placeholder="sk-..."
              />
            </Field>

            <Stack gap={4}>
              <Text size="sm" c="var(--nomi-ink)">模型</Text>
              <Stack gap={6}>
                {models.map((m, i) => (
                  <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                    <DesignTextInput
                      value={m.id}
                      onChange={e => updateModel(i, { id: e.currentTarget.value })}
                      placeholder="模型 id，如 llama3.1 / gpt-4o"
                      style={{ flex: 1.4 }}
                    />
                    <DesignTextInput
                      value={m.displayName}
                      onChange={e => updateModel(i, { displayName: e.currentTarget.value })}
                      placeholder="显示名（可选）"
                      style={{ flex: 1 }}
                    />
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => removeModelRow(i)}
                      disabled={models.length <= 1}
                      aria-label="删除这一行模型"
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
              <Group justify="flex-start">
                <DesignButton variant="subtle" leftSection={<IconPlus size={14} />} onClick={addModelRow}>
                  添加模型
                </DesignButton>
              </Group>
            </Stack>

            <Group justify="space-between" align="center">
              <Group gap={8} align="center">
                <DesignButton
                  variant="subtle"
                  onClick={handleTestConnection}
                  disabled={!baseUrlValid || testState === 'testing'}
                  loading={testState === 'testing'}
                >
                  测试连接
                </DesignButton>
                {testState === 'ok' && <Text size="xs" c="var(--nomi-ink-60)">✓ {testMessage}</Text>}
                {testState === 'fail' && <Text size="xs" c="var(--nomi-ink-60)" lineClamp={1}>✗ {testMessage}</Text>}
              </Group>
              <DesignButton onClick={handleManualSave} disabled={!canSaveManual} loading={saving}>
                保存
              </DesignButton>
            </Group>

            <Anchor
              component="button"
              type="button"
              onClick={() => setInputMode('docs')}
              c="var(--nomi-ink-60)"
              size="xs"
              style={{ alignSelf: 'flex-start' }}
            >
              要加图片 / 视频模型？让 AI 读文档自动配置 →
            </Anchor>
          </Stack>
        )}

        {phase === 'input' && inputMode === 'docs' && (
          <Stack gap="md">
            <Anchor
              component="button"
              type="button"
              onClick={() => setInputMode('manual')}
              c="var(--nomi-ink-60)"
              size="xs"
              style={{ alignSelf: 'flex-start' }}
            >
              ← 返回手动填写
            </Anchor>
            <Text size="xs" c="var(--nomi-ink-60)">
              适合图片 / 视频等非标准接口：AI 读官方文档，自动抠出参数并配置。需先有一个文本模型来读文档。
            </Text>
            <Field label="文档地址" hint="粘贴这个模型的官方 API 文档页">
              <DesignTextInput
                value={docsUrl}
                onChange={e => setDocsUrl(e.currentTarget.value)}
                placeholder="https://docs.example.com/api/..."
                autoFocus
              />
            </Field>
            <Field label="你的 API Key" hint="只存在你的电脑上，加密保存">
              <PasswordInput
                value={userApiKey}
                onChange={e => setUserApiKey(e.currentTarget.value)}
                placeholder="sk-..."
              />
            </Field>
            <Group justify="flex-end">
              <DesignButton onClick={handleStart} disabled={!canStart}>
                开始
              </DesignButton>
            </Group>
          </Stack>
        )}

        {phase === 'running' && (
          <Stack gap="sm">
            <Text size="sm" c="var(--nomi-ink)">{activeMessage}</Text>
            <Stack gap={4}>
              {milestones.map(m => (
                <MilestoneRow
                  key={m.id}
                  milestone={m}
                  detail={m.id === 'kind' && detectedKind ? `已识别为：${kindLabel(detectedKind)}` : m.id === 'fields' && fieldsCount > 0 ? `已提取 ${fieldsCount} 个参数` : undefined}
                />
              ))}
            </Stack>
            <Text size="xs" c="var(--nomi-ink-60)">预计还需 30-60 秒</Text>
            <Group justify="flex-start">
              <DesignButton variant="subtle" onClick={onClose}>取消</DesignButton>
            </Group>
          </Stack>
        )}

        {phase === 'success' && (
          <Stack gap="sm" align="flex-start">
            <Text size="xl" c="var(--nomi-ink)">✓</Text>
            <Text size="md" c="var(--nomi-ink)">{resultLabel} 已添加</Text>
            <Text size="sm" c="var(--nomi-ink-60)">现在可以在节点里选择这个模型</Text>
            <Group justify="space-between" w="100%">
              <DesignButton variant="subtle" onClick={() => { resetToInput(); }}>再添加一个</DesignButton>
              <DesignButton onClick={onClose}>完成</DesignButton>
            </Group>
          </Stack>
        )}

        {phase === 'error' && (
          <Stack gap="sm">
            <Text size="md" c="var(--nomi-ink)">没能完成添加</Text>
            <Text size="sm" c="var(--nomi-ink)">{errorReason}</Text>
            {errorHint && <Text size="sm" c="var(--nomi-ink-60)">{errorHint}</Text>}
            <Group justify="space-between">
              <DesignButton variant="subtle" onClick={handleCopyLog} disabled={!traceJson}>复制日志</DesignButton>
              <Group>
                <DesignButton variant="subtle" onClick={resetToInput}>改一改重试</DesignButton>
                <DesignButton onClick={onClose}>关闭</DesignButton>
              </Group>
            </Group>
          </Stack>
        )}
      </Stack>
    </DesignModal>
  )
}

function ProgressDots({ phase }: { phase: Phase }): JSX.Element {
  const stepIdx = phase === 'input' ? 0 : phase === 'running' ? 1 : 2
  return (
    <Group gap={6}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: i <= stepIdx ? 'var(--nomi-ink)' : 'var(--nomi-ink-20)',
          }}
        />
      ))}
    </Group>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <Stack gap={4}>
      <Text size="sm" c="var(--nomi-ink)">{label}</Text>
      {children}
      {hint && <Text size="xs" c="var(--nomi-ink-60)">{hint}</Text>}
    </Stack>
  )
}

function MilestoneRow({ milestone, detail }: { milestone: Milestone; detail?: string }): JSX.Element {
  const icon = milestone.status === 'done' ? '✓'
    : milestone.status === 'failed' ? '✗'
    : milestone.status === 'active' ? '◐'
    : '·'
  const color = milestone.status === 'pending' ? 'var(--nomi-ink-40)' : 'var(--nomi-ink-80)'
  return (
    <Group gap={8} wrap="nowrap">
      <Text size="sm" style={{ width: 14 }} c={color}>{icon}</Text>
      <Text size="sm" c={color}>{detail || milestone.label}</Text>
    </Group>
  )
}

function bumpToActive(milestones: Milestone[], id: Milestone['id']): Milestone[] {
  return milestones.map(m =>
    m.id === id ? { ...m, status: m.status === 'pending' ? 'active' : m.status } : m,
  )
}

function markStatus(milestones: Milestone[], id: Milestone['id'], status: Milestone['status']): Milestone[] {
  return milestones.map(m => m.id === id ? { ...m, status } : m)
}

function activeMessageFor(id: Milestone['id']): string {
  switch (id) {
    case 'read': return '正在阅读文档…'
    case 'kind': return '正在识别模型类型…'
    case 'identity': return '正在识别接口和认证方式…'
    case 'fields': return '正在提取参数…'
    case 'test': return '正在做一次测试调用…'
    case 'commit': return '正在保存到模型库…'
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'image': return '图片生成'
    case 'video': return '视频生成'
    case 'audio': return '音频生成'
    case 'text': return '文本'
    default: return kind
  }
}

function failureLabelFor(reason?: string): string {
  if (!reason) return '出了点问题'
  if (/401|403|auth/i.test(reason)) return 'API Key 被服务器拒绝'
  if (/404/.test(reason)) return '找不到这个接口'
  if (/gave up/i.test(reason)) return '读不懂这份文档'
  if (/No successful test/i.test(reason)) return '测试调用一直没通过'
  if (/fetch/i.test(reason)) return '打不开这个文档链接'
  return '没能完成添加'
}

function humanHintFor(reason?: string): string {
  if (!reason) return ''
  if (/401|403|auth/i.test(reason)) return '可能是 key 拷贝时多了空格，或这个 key 没开通这个模型。'
  if (/404/.test(reason)) return '文档地址可能不完整，或者这个模型已经下线。'
  if (/gave up/i.test(reason)) return '可能文档结构特殊。你可以换个更直接的端点说明页试试。'
  if (/No successful test/i.test(reason)) return '可能是参数不对，或者这个 key 余额不足。'
  if (/fetch/i.test(reason)) return '检查链接是否能在浏览器里打开。'
  return reason
}
