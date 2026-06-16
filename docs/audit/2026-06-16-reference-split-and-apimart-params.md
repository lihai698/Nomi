# 审计：参考真相源分裂 + apimart 全模型参数完整性（2026-06-16）

> 触发：用户真机「可灵 i2v 生成与参考图无关（白烧额度）」+「连线没连上但参考图上去了」+「怕其他视频模型也有此问题」+「查 apimart 参数是否完整」。两路 Explore agent 深审，本文汇总。

## 一、参考「显示真相源」vs「生成真相源」结构性分裂（系统性，影响所有视频模型）

**地基根因**：显示用 `resolveReferenceSlots`（`runner/referenceSlots.ts:73-148`），生成用**另一个独立函数** `resolveGenerationReferences`（`runner/generationReferenceResolver.ts:26-121`）。memory `connection-reference-bugs-2026-06-14` 的方案（`docs/plan/2026-06-14-connection-reference-capability-model.md`）的 **S3「生成也收口到 resolveReferenceSlots」从未落地**——只做了 S1（建函数）+ S4（显示接入）。两函数对边的处理规则不同 → 显示能画出的图，生成不一定读得到。

### 1a.「线没连上但参考图上去了」根因（钉死）
`nodes/completeNodeConnection.ts:17-28`：拖线到「当前模式有 image **数组**槽」的节点（可灵 i2v 的 image_ref、所有全能参考模式），走 `addAssetUrlToNode` 把 URL 写进 `meta.referenceImageUrls`，然后 **`cancelConnection()` + return——不建任何 edge**，且**不弹 toast**。
→ 现象：没有边/没有连线（CanvasEdgeLayer 画不出），但参考槽经 `resolveReferenceSlots` 的「上传」分支（referenceSlots.ts:124-137）显示出图。用户以为连线失败，其实写了 meta 参考。
- **系统性**：影响所有「当前模式声明 image 数组槽」的模型。纯单帧槽模型（Hailuo/Seedance keyframe）反而会建边、有线——所以不同模型表现不一致（数组槽 vs 单帧槽分界）。
- **注**：此 meta-only 路径**生成是会读到的**（buildArchetypeInputParams 读 meta.referenceImageUrls）→ 所以图其实进了请求。故 1a 本身不直接导致 #4。

### 1b. URL 优先级不一致
显示 `referenceUrl.ts:17` = `providerUrl || url || thumbnailUrl`；生成 `collectNodeContext`（`nodeContext.ts:48-50`）只读 `result.url || thumbnailUrl`，**不读 providerUrl**。源若只有 providerUrl 无 url → 显示有、生成兜不到。

### 1c. 对账静默放过（三口径不收敛）
`agent/reconcile.ts:88-113` 只遍历 agent 计划的边，**不扫描手动拖线产生的「无边有图」meta-only 状态** → 静默放过。

### #4 可灵 i2v 图没进请求体 —— 静态全通，待真实请求体
键名四环一致、构造层 meta 路径单测过、边+meta 双路汇入 image_urls、**本地化顺序也正确**（runtime.ts:473-485 先 localize extras 再从 localized extras 构建 params）、resultPreviewUrl 返回 result.url。**所有静态路径都说 image_urls 应该有可达图**。剩两种运行时原因静态看不出：① 源 URL 是 blob:/未本地化形态被 vendor 当空；② vendor 字段结构不符。**必须抓真实请求体**（见 `docs/handoff/2026-06-16-kling-i2v-reference-lost.md`）。

### 地基修法（让这类不再复发）
完成 **S3**：让 `generationNodeExecutor`/`buildArchetypeInputParams` 直接消费 `resolveReferenceSlots` 的 fills（含 origin/pending），删 `resolveGenerationReferences` 的独立边解析；对账同步断言「fills 里每个 edge-origin 都有真实 edge」（治 1c）。+ 拖线到数组槽时**也建边**（治 1a，显示=边=生成统一）。

## 二、apimart 全模型参数完整性（对官方文档，16 个模型）

### A. 缺核心能力/模式（重灾区，像 Seedance 之前那样）
| 模型 | 缺什么 | 官方 URL |
|---|---|---|
| **可灵 v3（用户正用,最高优先）** | `multi_shot` 多镜头分镜(shot_type/multi_prompt) + `element_list` 元素引用 + `negative_prompt`。档案注释自承"作后续增强"=明知故缺 | kling-v3/generation |
| **Veo 3.1** | `veo3.1-quality`/`veo3.1-lite` 两变体 + `generation_type`(frame/reference 模式区分) | veo3/generation |
| **Wan 2.7** | `video_urls` 视频续写 + `audio_url` 音频驱动两模式 + `seed` + `negative_prompt` | wan2.7/generation |
| **Omni-Flash-Ext** | `generation_type`(3图reference模式) + `video_urls` 参考视频 | omni-flash-ext/generation |
| **Nano Banana** | `mask_url` inpainting 局部重绘 | gemini-2.5-flash/generation |
| **Seedream 4.5** | `sequential_image_generation` 组图模式 + `n` | seedream-4.5/generation |

### B. 缺变体
Sora 2 缺 `sora-2-pro`；Hailuo 2.3 缺 `-Fast`；Qwen-Image 缺 `-pro`；Gemini 缺 `-official`。

### C. 取值/默认对不上官方（会 API 报错或行为偏差，**快修**）
- **Sora 2**：标准版 resolution 不该有 1080p（官方仅 720p）；duration 应离散枚举 4/8/12/16/20（现连续 number 可发非法值）。
- **Veo 3.1**：duration 官方仅 8，现允许 4-8。
- **Seedance 标准**：`generate_audio` 默认应 **false**（现 true）；标准版 resolution 默认应 480p（现 720p）；`return_last_frame` 仍缺（memory 点名过）。
- **GPT Image 2**：size 漏 `2:1/1:2/3:1/1:3`。
- **Omni-Flash-Ext**：image_urls slot 允许非法的 2 张（官方 0/1/3）。
- **Hailuo/Sora**：duration 离散枚举用了连续 number 控件。

### D. 普遍缺可选参数
`seed`(Wan)、`negative_prompt`(Kling/Wan/Qwen)、`n`(Seedream/Gemini/Qwen)、`watermark`(多视频)、`prompt_extend/optimizer`(Wan/Hailuo/Z-Image)。

**唯一完整**：Imagen 4。

## 三、修复优先级（待用户拍板范围 R3）
1. **P0 #4 真实请求体复现**（白烧额度，最该先钉）→ 烧 1 可灵额度抓 body。
2. **P0 取值快修**（C 类，防 API 报错）：Seedance generate_audio 默认 + Sora/Veo duration + Sora 1080p。安全数据改动。
3. **P1 线 bug**：拖数组槽加 toast「已作为参考图添加」（治混淆）；地基则做「也建边」。
4. **P1 地基 S3**：显示/生成收口同一真相源（治整类分裂）。
5. **P2 缺能力/变体**（A/B 类）：可灵 multi_shot/element_list、Veo/Wan/Omni 新模式、缺变体——逐模型补，工作量大，按用户关注度排（可灵优先）。
