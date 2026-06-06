import React from 'react'
import { cn } from '../../utils/cn'
import AssetTile, { AssetAddTile } from './AssetTile'
import AssetPicker from './AssetPicker'
import type { AssetKind, AssetRef } from './assetTypes'

// 节点侧的参考槽组件(P1.1)。**声明式 slot 描述符驱动**(R5):一份 AssetSlot 声明「要几个什么槽、
// 单还是数组、是否连边、怎么编号」,本组件按它渲染 —— 用通用 AssetTile + AssetPicker,不写专用交互。
// 替换旧的「单帧菜单 / 源视频槽 / ReferenceSlots 数组」三套。值与边的写入逻辑留在调用方(复用已验证的
// handleSlotAssignment/handleArrayAdd…),本组件只负责「呈现 + 回调」。

export type AssetSlot = {
  /** meta 存储键(单:firstFrameUrl/sourceVideoUrl…;数组:referenceImageUrls…)。 */
  key: string
  label: string
  accept: AssetKind
  /** single = 单槽(首/尾帧、源视频);array = 多参考(角色图/视频/音频)。 */
  form: 'single' | 'array'
  /** 单帧槽连画布边(首/尾帧);数组与源视频不连边(M6:数组绝不变持久边)。 */
  persistAsEdge: boolean
  /** 按放入顺序标 ①②③(角色图)。 */
  numbered: boolean
  max: number
  caption?: string
}

type AssetReferenceProps = {
  slots: AssetSlot[]
  /** 每个槽当前值:单 → 缩略图 url(空串=空);数组 → url 列表。 */
  valuesByKey: Record<string, string | string[]>
  projectId: string | null
  openSlotKey: string
  uploadingSlotKey: string
  onTogglePicker: (key: string) => void
  onPick: (slot: AssetSlot, asset: AssetRef) => void
  onUpload: (slot: AssetSlot, file: File) => void
  onRemove: (slot: AssetSlot, index: number) => void
}

// 把存好的 url 串包成最小 AssetRef,供 AssetTile 展示(渲染只需 kind + renderUrl)。
function displayRef(url: string, kind: AssetKind, name: string): AssetRef {
  return { id: url, kind, name, renderUrl: url, source: 'project', origin: { source: 'project', projectId: '', relativePath: '' } }
}

export default function AssetReference({
  slots, valuesByKey, projectId, openSlotKey, uploadingSlotKey,
  onTogglePicker, onPick, onUpload, onRemove,
}: AssetReferenceProps): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-[8px]')}>
      {slots.map((slot) => {
        const raw = valuesByKey[slot.key]
        const urls = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean)
        const canAdd = urls.length < slot.max
        const isOpen = openSlotKey === slot.key
        // 有值或还能加 → 显标签,让每个槽都可辨认(首/尾帧要区分、参考视频/音频的「+」要知道加的是啥)。
        const showHeader = urls.length > 0 || canAdd
        return (
          <div key={slot.key} className={cn('relative flex flex-col gap-[4px]')}>
            {showHeader ? (
              <div className={cn('flex items-baseline gap-[8px]')}>
                <span className={cn('text-nomi-ink-60 text-micro leading-none')}>{slot.label}</span>
                {slot.caption ? <span className={cn('text-nomi-ink-40 text-micro leading-none')}>{slot.caption}</span> : null}
              </div>
            ) : null}
            <div className={cn('flex flex-wrap items-center gap-[8px]')}>
              {urls.map((url, index) => (
                <AssetTile
                  key={`${url}-${index}`}
                  asset={displayRef(url, slot.accept, `${slot.label}${index + 1}`)}
                  index={slot.numbered ? index + 1 : undefined}
                  onRemove={() => onRemove(slot, index)}
                />
              ))}
              {canAdd ? <AssetAddTile label={`添加${slot.label}`} selected={isOpen} onClick={() => onTogglePicker(slot.key)} /> : null}
            </div>
            {isOpen ? (
              <div className={cn('absolute top-full left-0 z-[5] mt-[4px]')}>
                <AssetPicker
                  projectId={projectId}
                  accept={[slot.accept]}
                  uploading={uploadingSlotKey === slot.key}
                  onPick={(asset) => onPick(slot, asset)}
                  onUpload={(file) => onUpload(slot, file)}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
