import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopMp4ExportResult } from '../../desktop/bridge'
import type { TimelineState } from '../timeline/timelineTypes'
import type { PreviewAspectRatio } from '../workbenchTypes'
import { createTimelineExportFilename, downloadTimelineBlob, exportTimelineToWebm } from './timelineWebmExport'
import type { ExportQuality } from './exportTypes'

export type ExportTimelineToMp4Options = {
  timeline: TimelineState
  aspectRatio: PreviewAspectRatio
  projectId?: string
  outputName?: string
  resolution?: '720p' | '1080p'
  quality?: ExportQuality
  onProgress?: (progress: { status: 'preparing' | 'recording' | 'converting' | 'done'; ratio: number }) => void
}

export async function exportTimelineToMp4(options: ExportTimelineToMp4Options): Promise<DesktopMp4ExportResult> {
  const desktop = getDesktopBridge()
  if (!desktop?.exports?.start) {
    throw new Error('导出 MP4 需要 Electron 桌面运行时')
  }
  const projectId = (options.projectId || getDesktopActiveProjectId()).trim()
  if (!projectId) throw new Error('导出失败：缺少项目 ID')

  const webmBlob = await exportTimelineToWebm({
    timeline: options.timeline,
    aspectRatio: options.aspectRatio,
    width: options.resolution === '720p' ? 1280 : 1920,
    autoDownload: false,
    onProgress: (progress) => {
      if (progress.status === 'preparing' || progress.status === 'recording' || progress.status === 'done') {
        const status: 'preparing' | 'recording' | 'done' = progress.status
        options.onProgress?.({ status, ratio: progress.ratio * 0.82 })
      }
    },
  })

  options.onProgress?.({ status: 'converting', ratio: 0.86 })
  try {
    const result = await desktop.exports.start({
      projectId,
      webmBytes: await webmBlob.arrayBuffer(),
      outputName: options.outputName,
      resolution: options.resolution || '1080p',
      quality: options.quality || 'standard',
      fps: options.timeline.fps || 30,
    })
    options.onProgress?.({ status: 'done', ratio: 1 })
    return result
  } catch (error) {
    const fallbackName = createTimelineExportFilename('webm')
    downloadTimelineBlob(webmBlob, fallbackName)
    const message = error instanceof Error ? error.message : 'MP4 导出失败'
    throw new Error(`${message}。已自动下载 WebM 备用文件：${fallbackName}`)
  }
}
