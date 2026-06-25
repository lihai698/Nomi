/* eslint-disable react-hooks/exhaustive-deps -- Migrated Leafer canvas keeps imperative renderer state in refs to avoid recreating the editor on every pointer update. */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from 'react'

import type { AspectRatioKey, CanvasAsset, CanvasDimensions, LayerItem, ToolKey } from './lib/canvas'
import { getCanvasPointFromClient } from './lib/pointer'
import { createSmoothStrokePath, normalizePointerPoint, type PointerPoint } from './lib/stroke'
import type {
  CanvasAssetTransform,
  CanvasNodeInteractionState,
  CanvasObjectFlipState,
  CanvasObjectKind,
  CanvasObjectOffset,
  CanvasObjectTarget,
  CanvasPoint,
  CanvasStroke,
  LeaferApp,
  LeaferBox,
  LeaferGroup,
  LeaferRenderContext,
  MutableDraftEraserPath,
  SnapGuide,
} from './whiteboardCanvasTypes'
import {
  createViewportScreenshotFilename,
  exportViewportFileWithoutEditorOverlays,
  exportViewportWithoutEditorOverlays,
  fitLeaferCanvasToHost,
} from './whiteboardCanvasExport'
import {
  getCanvasNodeBounds,
  getCanvasNodeInteractionState,
  getCanvasObjectTarget,
  getFiniteNumber,
  getObjectFlipState,
  getObjectKey,
  isPointInsideBounds,
  setCanvasNodeInteractionState,
  setCircleGeometry,
  shouldAppendPoint,
  shouldBlockErasedSelection,
} from './whiteboardCanvasNodeOps'
import {
  areCanvasTargetArraysEqual,
  areCanvasTargetsEqual,
  getActiveMultiSelectionTargets,
  getAssetRenderBounds,
  getCanvasHitRadiusFromStageBounds,
  getCanvasTargetsUnionBounds,
  getKeyboardMoveDelta,
  getLayerIdForCanvasObject,
  getMinimumAssetScale,
  getSelectableCanvasObjectsInBounds,
  getSnappedCanvasMove,
  getSvgRectAttributes,
  getTopmostEditableCanvasObjectAtPoint,
  isCanvasContextMenuEvent,
  isEditableKeyboardTarget,
  isPointNearSingleAssetResizeHandle,
  normalizeAssetBounds,
  normalizeCanvasBounds,
  shouldBlockEditorTargetInteraction,
} from './whiteboardCanvasGeometry'
import { renderWhiteboardScene } from './whiteboardSceneRender'

export type { CanvasObjectTarget, CanvasStroke } from './whiteboardCanvasTypes'

type LeaferCanvasProps = {
  ratio: AspectRatioKey
  dimensions: CanvasDimensions
  fitMode?: 'bounded' | 'natural'
  activeTool: ToolKey
  activeLayerId: string
  layers: LayerItem[]
  assets: CanvasAsset[]
  color: string
  brushSize: number
  strokes: CanvasStroke[]
  activeObjectTarget?: CanvasObjectTarget | null
  onStrokeCommit: (stroke: CanvasStroke) => void
  onLayerSelect?: (layerId: string) => void
  onObjectSelect?: (target: CanvasObjectTarget, layerId: string) => void
  onObjectsGroup?: (targets: CanvasObjectTarget[]) => void
  onObjectDelete?: (target: CanvasObjectTarget) => void
}

export type LeaferCanvasHandle = {
  captureViewport: (filename?: string) => Promise<void>
  captureViewportFile: (filename?: string) => Promise<File>
  clientPointToCanvasPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
}

type CanvasContextMenuState = {
  x: number
  y: number
  targets: CanvasObjectTarget[]
}
type CanvasSelectionBox = {
  start: CanvasPoint
  current: CanvasPoint
}

export const LeaferCanvas = forwardRef<LeaferCanvasHandle, LeaferCanvasProps>(function LeaferCanvas({
  ratio,
  dimensions,
  fitMode = 'natural',
  activeTool,
  activeLayerId,
  layers,
  assets,
  color,
  brushSize,
  strokes,
  activeObjectTarget,
  onStrokeCommit,
  onLayerSelect,
  onObjectSelect,
  onObjectsGroup,
  onObjectDelete
}: LeaferCanvasProps, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const pointerLayerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<LeaferApp | null>(null)
  const renderContextRef = useRef<LeaferRenderContext | null>(null)
  const activePointerRef = useRef<number | null>(null)
  const pointsRef = useRef<PointerPoint[]>([])
  const strokesRef = useRef(strokes)
  const assetsRef = useRef(assets)
  const layersRef = useRef(layers)
  const dimensionsRef = useRef(dimensions)
  const activeToolRef = useRef(activeTool)
  const activeObjectTargetRef = useRef(activeObjectTarget)
  const onLayerSelectRef = useRef(onLayerSelect)
  const onObjectSelectRef = useRef(onObjectSelect)
  const onObjectsGroupRef = useRef(onObjectsGroup)
  const onObjectDeleteRef = useRef(onObjectDelete)
  const objectOffsetsRef = useRef<Map<string, CanvasObjectOffset>>(new Map())
  const assetTransformsRef = useRef<Map<string, CanvasAssetTransform>>(new Map())
  const layerGroupsRef = useRef<Map<string, LeaferGroup>>(new Map())
  const canvasObjectNodesRef = useRef<Map<string, LeaferBox>>(new Map())
  const layerObjectTargetsRef = useRef<Map<string, CanvasObjectTarget>>(new Map())
  const pointerBoundsRef = useRef<DOMRect | null>(null)
  const selectionPointRef = useRef<CanvasPoint | null>(null)
  const selectedObjectTargetsRef = useRef<CanvasObjectTarget[]>([])
  const multiSelectedObjectTargetsRef = useRef<CanvasObjectTarget[]>([])
  const contextMenuTargetsRef = useRef<CanvasObjectTarget[]>([])
  const groupMenuActionHandledRef = useRef(false)
  const multiSelectionInteractionSnapshotsRef = useRef<Map<string, CanvasNodeInteractionState>>(new Map())
  const boxSelectStartRef = useRef<CanvasPoint | null>(null)
  const boxSelectCurrentRef = useRef<CanvasPoint | null>(null)
  const boxSelectPointerRef = useRef<number | null>(null)
  const isBoxSelectingRef = useRef(false)
  const multiSelectionDragRef = useRef<{
    pointerId: number
    lastPoint: CanvasPoint
    totalDelta: CanvasPoint
    targets: CanvasObjectTarget[]
  } | null>(null)
  const shouldBlockSelectionRef = useRef<(target: unknown) => boolean>(() => false)
  const strokeLayerIdRef = useRef(activeLayerId)
  const objectFlipStatesRef = useRef<Map<string, CanvasObjectFlipState>>(new Map())
  const draftFrameRef = useRef<number | null>(null)
  const pendingDraftPointsRef = useRef<PointerPoint[]>([])
  const draftPathRef = useRef<SVGPathElement | null>(null)
  const draftEraserPathRef = useRef<MutableDraftEraserPath | null>(null)
  const cursorGroupRef = useRef<SVGGElement | null>(null)
  const eraserHaloRef = useRef<SVGCircleElement | null>(null)
  const eraserOutlineRef = useRef<SVGCircleElement | null>(null)
  const multiSelectionOutlineRef = useRef<SVGRectElement | null>(null)
  const snapGuideGroupRef = useRef<SVGGElement | null>(null)
  const snapGuideTimeoutRef = useRef<number | null>(null)
  const [renderReadyVersion, setRenderReadyVersion] = useState(0)
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null)
  const [selectionBox, setSelectionBox] = useState<CanvasSelectionBox | null>(null)
  const [selectedObjectTargets, setSelectedObjectTargets] = useState<CanvasObjectTarget[]>([])

  useImperativeHandle(
    ref,
    () => ({
      async captureViewport(filename = createViewportScreenshotFilename()) {
        const app = appRef.current
        if (!app) {
          throw new Error('画布还未准备好')
        }

        const result = await exportViewportWithoutEditorOverlays(app, filename)

        if (result.error) {
          throw result.error instanceof Error ? result.error : new Error('截图失败')
        }
      },
      async captureViewportFile(filename = createViewportScreenshotFilename()) {
        const app = appRef.current
        if (!app) {
          throw new Error('画布还未准备好')
        }

        return exportViewportFileWithoutEditorOverlays(app, filename)
      },
      clientPointToCanvasPoint(clientX: number, clientY: number) {
        const stage = stageRef.current
        if (!stage) return null
        const point = getCanvasPointFromClient(clientX, clientY, stage.getBoundingClientRect(), dimensionsRef.current)
        return { x: point[0], y: point[1] }
      }
    }),
    []
  )

  const updateSelectedObjectTargets = useCallback((targets: CanvasObjectTarget[]) => {
    if (targets.length > 1) {
      multiSelectedObjectTargetsRef.current = targets
    }
    selectedObjectTargetsRef.current = targets
    setSelectedObjectTargets((currentTargets) =>
      areCanvasTargetArraysEqual(currentTargets, targets) ? currentTargets : targets
    )
  }, [])

  strokesRef.current = strokes
  assetsRef.current = assets
  layersRef.current = layers
  dimensionsRef.current = dimensions
  activeToolRef.current = activeTool
  activeObjectTargetRef.current = activeObjectTarget
  strokeLayerIdRef.current = activeLayerId
  onLayerSelectRef.current = onLayerSelect
  onObjectSelectRef.current = onObjectSelect
  onObjectsGroupRef.current = onObjectsGroup
  onObjectDeleteRef.current = onObjectDelete
  selectedObjectTargetsRef.current = selectedObjectTargets
  shouldBlockSelectionRef.current = (target) =>
    shouldBlockErasedSelection(
      target,
      selectionPointRef.current,
      strokesRef.current,
      assetsRef.current,
      objectOffsetsRef.current
    )

  function paintSnapGuides(guides: SnapGuide[]): void {
    const group = snapGuideGroupRef.current
    if (!group) {
      return
    }

    if (snapGuideTimeoutRef.current !== null) {
      window.clearTimeout(snapGuideTimeoutRef.current)
      snapGuideTimeoutRef.current = null
    }

    group.replaceChildren()

    if (guides.length === 0) {
      group.style.display = 'none'
      return
    }

    const namespace = 'http://www.w3.org/2000/svg'

    for (const guide of guides) {
      const line = document.createElementNS(namespace, 'line')
      line.setAttribute('vector-effect', 'non-scaling-stroke')
      line.setAttribute('stroke', 'var(--accent-strong)')
      line.setAttribute('stroke-width', '1.4')
      line.setAttribute('stroke-dasharray', '9 7')
      line.setAttribute('opacity', '0.9')

      if (guide.axis === 'x') {
        line.setAttribute('x1', String(guide.position))
        line.setAttribute('x2', String(guide.position))
        line.setAttribute('y1', '0')
        line.setAttribute('y2', String(dimensions.height))
      } else {
        line.setAttribute('x1', '0')
        line.setAttribute('x2', String(dimensions.width))
        line.setAttribute('y1', String(guide.position))
        line.setAttribute('y2', String(guide.position))
      }

      group.appendChild(line)
    }

    group.style.display = 'block'
    snapGuideTimeoutRef.current = window.setTimeout(() => {
      group.replaceChildren()
      group.style.display = 'none'
      snapGuideTimeoutRef.current = null
    }, 220)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    let isDisposed = false

    host.replaceChildren()
    renderContextRef.current = null
    appRef.current = null

    Promise.all([import('leafer-ui'), import('@leafer-in/editor'), import('@leafer-in/export')]).then(([module]) => {
      if (isDisposed || hostRef.current !== host) {
        return
      }

      const { App, Group } = module
      const hostStyle = window.getComputedStyle(host)
      const accentColor = hostStyle.getPropertyValue('--nomi-accent').trim() || '#3b82f6'
      const paperColor = hostStyle.getPropertyValue('--nomi-paper').trim() || '#ffffff'
      const app = new App({
        view: host,
        width: dimensions.width,
        height: dimensions.height,
        fill: paperColor,
        tree: { type: 'draw' },
        wheel: {
          disabled: true,
          preventDefault: false
        },
        touch: {
          preventDefault: false
        },
        move: {
          disabled: true,
          holdSpaceKey: false,
          holdMiddleKey: false,
          holdRightKey: false,
          drag: false,
          dragEmpty: false
        },
        zoom: {
          disabled: true
        },
        keyEvent: false,
        editor: {
          keyEvent: false,
          moveable: true,
          resizeable: false,
          lockRatio: true,
          flipable: false,
          rotateable: false,
          skewable: false,
          selector: true,
          hover: true,
          multipleSelect: false,
          boxSelect: false,
          stroke: accentColor,
          strokeWidth: 1.5,
          pointFill: paperColor,
          pointSize: 10,
          pointRadius: 3,
          hideRotatePoints: true,
          hideResizeLines: true,
          beforeMove: ({ target, x, y }: { target?: unknown; x: number; y: number }) =>
            getSnappedCanvasMove({
              target,
              x,
              y,
              dimensions,
              layers: layersRef.current,
              assets: assetsRef.current,
              strokes: strokesRef.current,
              offsets: objectOffsetsRef.current,
              assetTransforms: assetTransformsRef.current,
              onSnapGuides: paintSnapGuides
            }),
          beforeScale: ({ target, scaleX, scaleY }: { target?: unknown; scaleX?: number; scaleY?: number }) =>
            getMinimumAssetScale(target, scaleX, scaleY, assetTransformsRef.current, assetsRef.current),
          beforeSelect: ({ target }: { target?: unknown }) =>
            shouldBlockEditorTargetInteraction(
              target,
              selectedObjectTargetsRef.current,
              isBoxSelectingRef.current,
              Boolean(multiSelectionDragRef.current),
              shouldBlockSelectionRef.current
            )
              ? false
              : undefined,
          beforeHover: ({ target }: { target?: unknown }) =>
            shouldBlockEditorTargetInteraction(
              target,
              selectedObjectTargetsRef.current,
              isBoxSelectingRef.current,
              Boolean(multiSelectionDragRef.current),
              shouldBlockSelectionRef.current
            )
              ? false
              : undefined
        }
      })
      const rootGroup = new Group()

      fitLeaferCanvasToHost(app)
      app.tree.add(rootGroup)
      appRef.current = app
      renderContextRef.current = {
        app,
        Box: module.Box,
        Group: module.Group,
        Image: module.Image,
        Path: module.Path,
        PathCommandMap: module.PathCommandMap,
        PathConvert: module.PathConvert,
        PathNumberCommandLengthMap: module.PathNumberCommandLengthMap,
        Rect: module.Rect,
        rootGroup
      }
      setRenderReadyVersion((version) => version + 1)
    })

    return () => {
      isDisposed = true
      if (snapGuideTimeoutRef.current !== null) {
        window.clearTimeout(snapGuideTimeoutRef.current)
        snapGuideTimeoutRef.current = null
      }
      snapGuideGroupRef.current?.replaceChildren()
      renderContextRef.current = null
      appRef.current?.destroy?.()
      appRef.current = null
      host.replaceChildren()
    }
  }, [dimensions.height, dimensions.width])

  useLayoutEffect(() => {
    const context = renderContextRef.current
    if (!context) {
      return
    }

    renderWhiteboardScene({
      context,
      assets,
      strokes,
      layers,
      dimensions,
      objectOffsets: objectOffsetsRef.current,
      assetTransforms: assetTransformsRef.current,
      objectFlipStates: objectFlipStatesRef.current,
      layerGroupsRef,
      canvasObjectNodesRef,
      layerObjectTargetsRef,
      draftEraserPathRef,
    })
  }, [assets, dimensions.height, dimensions.width, layers, renderReadyVersion, strokes])

  useEffect(() => {
    const editor = renderContextRef.current?.app.editor
    if (!editor) {
      return
    }

    if (activeTool !== 'select') {
      paintSnapGuides([])
      editor.cancel()
      return
    }

    if (isBoxSelectingRef.current || selectedObjectTargetsRef.current.length > 1) {
      paintSnapGuides([])
      editor.cancel?.()
      return
    }

    const objectTarget = activeObjectTargetRef.current ?? layerObjectTargetsRef.current.get(activeLayerId)
    const node = objectTarget ? canvasObjectNodesRef.current.get(getObjectKey(objectTarget.kind, objectTarget.id)) : null

    if (node) {
      editor.select?.(node)
    } else {
      editor.cancel?.()
    }
  }, [activeLayerId, activeObjectTarget, activeTool, assets, layers, renderReadyVersion, selectedObjectTargets, strokes])

  useEffect(() => {
    setContextMenu(null)
    setSelectionBox(null)

    if (activeTool !== 'select') {
      multiSelectedObjectTargetsRef.current = []
      updateSelectedObjectTargets([])
      return
    }

    const multiTargets = getActiveMultiSelectionTargets(
      selectedObjectTargetsRef.current,
      multiSelectedObjectTargetsRef.current
    )
    if (
      activeObjectTarget &&
      multiTargets.length > 1 &&
      multiTargets.some((target) => areCanvasTargetsEqual(target, activeObjectTarget))
    ) {
      updateSelectedObjectTargets(multiTargets)
      return
    }

    if (activeObjectTarget) {
      multiSelectedObjectTargetsRef.current = []
    }
    updateSelectedObjectTargets(activeObjectTarget ? [activeObjectTarget] : [])
  }, [activeObjectTarget, activeTool, updateSelectedObjectTargets])

  useEffect(() => {
    const snapshots = multiSelectionInteractionSnapshotsRef.current
    const disabledKeys =
      activeTool === 'select' && selectedObjectTargets.length > 1
        ? new Set(selectedObjectTargets.map((target) => getObjectKey(target.kind, target.id)))
        : new Set<string>()

    for (const [key, snapshot] of snapshots) {
      if (disabledKeys.has(key)) {
        continue
      }

      const node = canvasObjectNodesRef.current.get(key)
      if (node) {
        setCanvasNodeInteractionState(node, snapshot)
      }
      snapshots.delete(key)
    }

    for (const key of disabledKeys) {
      const node = canvasObjectNodesRef.current.get(key)
      if (!node) {
        continue
      }

      if (!snapshots.has(key)) {
        snapshots.set(key, getCanvasNodeInteractionState(node))
      }
      setCanvasNodeInteractionState(node, {
        editable: false,
        draggable: false,
        hittable: false,
        hitFill: 'none'
      })
    }
  }, [activeTool, assets, layers, renderReadyVersion, selectedObjectTargets, strokes])

  useEffect(() => {
    const editor = renderContextRef.current?.app.editor
    if (!editor) {
      return
    }

    const handleEditorMove = (event: unknown) => {
      const moveEvent = event as {
        moveX?: number
        moveY?: number
        target?: {
          canvasObjectKind?: CanvasObjectKind
          canvasObjectId?: string
        }
      }
      const kind = moveEvent.target?.canvasObjectKind
      const id = moveEvent.target?.canvasObjectId

      if (!kind || !id) {
        return
      }

      const key = getObjectKey(kind, id)
      const offset = objectOffsetsRef.current.get(key) ?? { x: 0, y: 0 }
      objectOffsetsRef.current.set(key, {
        x: offset.x + (moveEvent.moveX ?? 0),
        y: offset.y + (moveEvent.moveY ?? 0)
      })

      if (kind === 'asset') {
        const asset = assetsRef.current.find((item) => item.id === id)
        const currentTransform = assetTransformsRef.current.get(id)

        if (asset && currentTransform) {
          assetTransformsRef.current.set(id, {
            ...currentTransform,
            x: currentTransform.x + (moveEvent.moveX ?? 0),
            y: currentTransform.y + (moveEvent.moveY ?? 0)
          })
        }
      }
    }

    const handleEditorScale = (event: unknown) => {
      const scaleEvent = event as {
        scaleX?: number
        scaleY?: number
        target?: unknown
      }
      const objectTarget = getCanvasObjectTarget(scaleEvent.target)

      if (objectTarget?.kind !== 'asset') {
        return
      }

      const asset = assetsRef.current.find((item) => item.id === objectTarget.id)
      if (!asset) {
        return
      }

      const currentBounds = getAssetRenderBounds(asset, objectOffsetsRef.current, assetTransformsRef.current)
      const targetBounds = getCanvasNodeBounds(scaleEvent.target)
      const nextBounds = normalizeAssetBounds({
        x: targetBounds.x ?? currentBounds.x,
        y: targetBounds.y ?? currentBounds.y,
        width: targetBounds.width ?? currentBounds.width * Math.abs(scaleEvent.scaleX ?? 1),
        height: targetBounds.height ?? currentBounds.height * Math.abs(scaleEvent.scaleY ?? 1)
      })

      assetTransformsRef.current.set(asset.id, nextBounds)
      objectOffsetsRef.current.set(getObjectKey('asset', asset.id), {
        x: nextBounds.x - asset.x,
        y: nextBounds.y - asset.y
      })
    }

    const handleEditorSelect = (event: unknown) => {
      const selectEvent = event as {
        value?: unknown
        target?: unknown
      }
      const selectedTarget = Array.isArray(selectEvent.value) ? selectEvent.value[0] : selectEvent.value
      const objectTarget = getCanvasObjectTarget(selectedTarget ?? selectEvent.target)
      const layerId = objectTarget
        ? getLayerIdForCanvasObject(objectTarget, assetsRef.current, strokesRef.current)
        : null

      if (
        objectTarget &&
        shouldBlockEditorTargetInteraction(
          objectTarget,
          getActiveMultiSelectionTargets(selectedObjectTargetsRef.current, multiSelectedObjectTargetsRef.current),
          isBoxSelectingRef.current,
          Boolean(multiSelectionDragRef.current),
          () => false
        )
      ) {
        return
      }

      if (objectTarget && layerId) {
        multiSelectedObjectTargetsRef.current = []
        activeObjectTargetRef.current = objectTarget
        updateSelectedObjectTargets([objectTarget])
        onLayerSelectRef.current?.(layerId)
        onObjectSelectRef.current?.(objectTarget, layerId)
      }
    }

    editor.on?.('editor.move', handleEditorMove)
    editor.on?.('editor.scale', handleEditorScale)
    editor.on?.('editor.select', handleEditorSelect)

    return () => {
      editor.off?.('editor.move', handleEditorMove)
      editor.off?.('editor.scale', handleEditorScale)
      editor.off?.('editor.select', handleEditorSelect)
    }
  }, [renderReadyVersion])

  const getEditableSelectedTarget = useCallback(() => {
    const target = activeObjectTargetRef.current
    if (!target || activeTool !== 'select') {
      return null
    }

    const layerId = getLayerIdForCanvasObject(target, assetsRef.current, strokesRef.current)
    const layer = layerId ? layersRef.current.find((item) => item.id === layerId) : null

    if (!layer || layer.locked || !layer.visible || layer.kind === 'background') {
      return null
    }

    return target
  }, [activeTool])

  const moveSelectedTarget = useCallback(
    (deltaX: number, deltaY: number) => {
      const target = getEditableSelectedTarget()
      if (!target) {
        return false
      }

      const key = getObjectKey(target.kind, target.id)
      const offset = objectOffsetsRef.current.get(key) ?? { x: 0, y: 0 }
      objectOffsetsRef.current.set(key, {
        x: offset.x + deltaX,
        y: offset.y + deltaY
      })

      if (target.kind === 'asset') {
        const currentTransform = assetTransformsRef.current.get(target.id)
        if (currentTransform) {
          assetTransformsRef.current.set(target.id, {
            ...currentTransform,
            x: currentTransform.x + deltaX,
            y: currentTransform.y + deltaY
          })
        }
      }

      setRenderReadyVersion((version) => version + 1)
      return true
    },
    [getEditableSelectedTarget]
  )

  const deleteSelectedTarget = useCallback(() => {
    const target = getEditableSelectedTarget()
    if (!target) {
      return false
    }

    renderContextRef.current?.app.editor.cancel?.()
    activeObjectTargetRef.current = null
    onObjectDeleteRef.current?.(target)
    return true
  }, [getEditableSelectedTarget])

  const flipSelectedTarget = useCallback(
    (axis: 'x' | 'y') => {
      const target = contextMenu?.targets.length === 1 ? contextMenu.targets[0] : getEditableSelectedTarget()
      if (!target) {
        setContextMenu(null)
        return
      }

      const key = getObjectKey(target.kind, target.id)
      const currentFlip = getObjectFlipState(objectFlipStatesRef.current, target)
      objectFlipStatesRef.current.set(key, {
        ...currentFlip,
        [axis]: !currentFlip[axis]
      })

      const node = canvasObjectNodesRef.current.get(key) as
        | (LeaferBox & { flip?: (axis: 'x' | 'y', transition?: boolean | number) => void })
        | undefined
      node?.flip?.(axis)
      setContextMenu(null)
      setRenderReadyVersion((version) => version + 1)
    },
    [contextMenu?.targets, getEditableSelectedTarget]
  )

  const groupSelectedTargets = useCallback(() => {
    if (groupMenuActionHandledRef.current) {
      return
    }

    const menuTargets = contextMenu?.targets.length ? contextMenu.targets : contextMenuTargetsRef.current
    const selectedTargets = selectedObjectTargetsRef.current
    const multiTargets = getActiveMultiSelectionTargets(selectedTargets, multiSelectedObjectTargetsRef.current)
    const targets = menuTargets.length > 1 ? menuTargets : multiTargets
    const groupableTargets = targets.filter(
      (target) => target.kind === 'asset' || target.kind === 'stroke' || target.kind === 'group'
    )

    if (groupableTargets.length < 2) {
      setContextMenu(null)
      return
    }

    groupMenuActionHandledRef.current = true
    onObjectsGroupRef.current?.(groupableTargets)
    multiSelectedObjectTargetsRef.current = []
    contextMenuTargetsRef.current = []
    updateSelectedObjectTargets([])
    setContextMenu(null)
  }, [contextMenu?.targets, updateSelectedObjectTargets])

  const handleGroupMenuPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const handleGroupMenuPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const handleGroupMenuMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const handleGroupMenuClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const showContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (activeTool !== 'select') {
        return
      }

      event.preventDefault()
      const stage = stageRef.current
      if (!stage) {
        return
      }

      const stageBounds = stage.getBoundingClientRect()
      const point = getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        stageBounds,
        dimensions,
        0.5
      )
      const canvasPoint = { x: point[0], y: point[1] }
      const selectedTargets = selectedObjectTargetsRef.current
      const multiTargets = getActiveMultiSelectionTargets(selectedTargets, multiSelectedObjectTargetsRef.current)
      const selectedGroupBounds =
        multiTargets.length > 1
          ? getCanvasTargetsUnionBounds(
              multiTargets,
              layersRef.current,
              assetsRef.current,
              strokesRef.current,
              objectOffsetsRef.current,
              assetTransformsRef.current
            )
          : null

      if (selectedGroupBounds && isPointInsideBounds(canvasPoint, selectedGroupBounds)) {
        event.stopPropagation()
        contextMenuTargetsRef.current = multiTargets
        groupMenuActionHandledRef.current = false
        updateSelectedObjectTargets(multiTargets)
        setContextMenu({
          x: Math.min(stageBounds.width - 132, Math.max(8, event.clientX - stageBounds.left + 8)),
          y: Math.min(stageBounds.height - 88, Math.max(8, event.clientY - stageBounds.top + 8)),
          targets: multiTargets
        })
        return
      }

      const hit = getTopmostEditableCanvasObjectAtPoint(
        canvasPoint,
        layersRef.current,
        assetsRef.current,
        strokesRef.current,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )

      if (!hit) {
        contextMenuTargetsRef.current = []
        groupMenuActionHandledRef.current = false
        setContextMenu(null)
        return
      }

      event.stopPropagation()
      const shouldUseMultiSelection =
        multiTargets.length > 1 && multiTargets.some((target) => areCanvasTargetsEqual(target, hit.target))
      const menuTargets = shouldUseMultiSelection ? multiTargets : [hit.target]

      if (!shouldUseMultiSelection) {
        multiSelectedObjectTargetsRef.current = []
        activeObjectTargetRef.current = hit.target
        updateSelectedObjectTargets([hit.target])
        onLayerSelectRef.current?.(hit.layerId)
        onObjectSelectRef.current?.(hit.target, hit.layerId)
      }

      contextMenuTargetsRef.current = menuTargets
      groupMenuActionHandledRef.current = false
      setContextMenu({
        x: Math.min(stageBounds.width - 132, Math.max(8, event.clientX - stageBounds.left + 8)),
        y: Math.min(stageBounds.height - 88, Math.max(8, event.clientY - stageBounds.top + 8)),
        targets: menuTargets
      })
    },
    [activeTool, dimensions, updateSelectedObjectTargets]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) {
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (deleteSelectedTarget()) {
          event.preventDefault()
        }
        return
      }

      const step = event.shiftKey ? 10 : 1
      const moveDelta = getKeyboardMoveDelta(event.key, step)
      if (!moveDelta) {
        return
      }

      if (moveSelectedTarget(moveDelta.x, moveDelta.y)) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [deleteSelectedTarget, moveSelectedTarget])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const closeContextMenu = (event?: PointerEvent) => {
      if (isCanvasContextMenuEvent(event)) {
        return
      }

      setContextMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }

    window.addEventListener('pointerdown', closeContextMenu)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', closeContextMenu)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const suppressRightClickSelection = (event: PointerEvent) => {
      if (
        activeToolRef.current !== 'select' ||
        event.button <= 0 ||
        selectedObjectTargetsRef.current.length < 2
      ) {
        return
      }

      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    stage.addEventListener('pointerdown', suppressRightClickSelection, true)

    return () => {
      stage.removeEventListener('pointerdown', suppressRightClickSelection, true)
    }
  }, [])

  const activeLayer = layers.find((layer) => layer.id === activeLayerId)
  const canDraw = (activeTool === 'brush' || activeTool === 'eraser') && Boolean(activeLayer && !activeLayer.locked)

  const hideToolCursor = useCallback(() => {
    if (activePointerRef.current !== null) {
      return
    }

    const cursorGroup = cursorGroupRef.current
    if (cursorGroup) {
      cursorGroup.style.display = 'none'
    }
    pointerBoundsRef.current = null
  }, [])

  const clearDraftPreview = useCallback(() => {
    if (draftFrameRef.current !== null) {
      window.cancelAnimationFrame(draftFrameRef.current)
      draftFrameRef.current = null
    }

    pendingDraftPointsRef.current = []

    const draftPath = draftPathRef.current
    if (draftPath) {
      draftPath.removeAttribute('d')
      draftPath.style.display = 'none'
    }

    const draftEraserPath = draftEraserPathRef.current
    if (draftEraserPath) {
      draftEraserPath.path = ''
      draftEraserPath.visible = false
      draftEraserPath.remove?.()
      draftEraserPathRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!canDraw) {
      activePointerRef.current = null
      pointsRef.current = []
      clearDraftPreview()
      hideToolCursor()
    }
  }, [canDraw, clearDraftPreview, hideToolCursor])

  useEffect(() => {
    return () => {
      clearDraftPreview()
    }
  }, [clearDraftPreview])

  const getPointFromPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, preferCachedBounds = false): PointerPoint => {
      const pointerLayer = pointerLayerRef.current
      if (!pointerLayer) {
        return normalizePointerPoint(0, 0, event.pressure)
      }

      const bounds =
        preferCachedBounds && pointerBoundsRef.current
          ? pointerBoundsRef.current
          : pointerLayer.getBoundingClientRect()
      pointerBoundsRef.current = bounds

      return getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        bounds,
        dimensions,
        event.pressure
      )
    },
    [dimensions.height, dimensions.width]
  )

  const paintToolCursor = useCallback(
    (point: PointerPoint) => {
      const cursorGroup = cursorGroupRef.current
      if (!cursorGroup) {
        return
      }

      if (activeTool === 'eraser') {
        const radius = brushSize / 2
        cursorGroup.style.display = 'block'
        setCircleGeometry(eraserHaloRef.current, point, radius)
        setCircleGeometry(eraserOutlineRef.current, point, radius)
        return
      }

      cursorGroup.style.display = 'none'
    },
    [activeTool, brushSize]
  )

  const updateToolCursor = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDraw) {
        hideToolCursor()
        return null
      }

      const point = getPointFromPointer(event, activePointerRef.current === event.pointerId)
      paintToolCursor(point)

      return point
    },
    [canDraw, getPointFromPointer, hideToolCursor, paintToolCursor]
  )

  const ensureDraftEraserPath = useCallback(() => {
    if (draftEraserPathRef.current) {
      return draftEraserPathRef.current
    }

    const context = renderContextRef.current
    const layerGroup = layerGroupsRef.current.get(strokeLayerIdRef.current)
    if (!context || !layerGroup) {
      return null
    }

    const draftEraserPath = new context.Path({
      path: '',
      fill: '#000000',
      eraser: 'path',
      editable: false,
      draggable: false,
      hittable: false,
      hitFill: 'none',
      visible: false
    }) as MutableDraftEraserPath

    layerGroup.add(draftEraserPath)
    draftEraserPathRef.current = draftEraserPath

    return draftEraserPath
  }, [])

  const updateDraftPreview = useCallback(
    (nextPoints: PointerPoint[]) => {
      pendingDraftPointsRef.current = nextPoints

      if (draftFrameRef.current !== null) {
        return
      }

      draftFrameRef.current = window.requestAnimationFrame(() => {
        draftFrameRef.current = null

        const path = createSmoothStrokePath(pendingDraftPointsRef.current, brushSize)

        if (activeTool === 'eraser') {
          const draftEraserPath = ensureDraftEraserPath()
          if (draftEraserPath) {
            draftEraserPath.path = path
            draftEraserPath.visible = Boolean(path)
          }
          return
        }

        const draftPath = draftPathRef.current
        if (!draftPath) {
          return
        }

        if (!path) {
          draftPath.removeAttribute('d')
          draftPath.style.display = 'none'
          return
        }

        draftPath.setAttribute('d', path)
        draftPath.setAttribute('fill', color)
        draftPath.style.display = 'block'
      })
    },
    [activeTool, brushSize, color, ensureDraftEraserPath]
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDraw) {
        return
      }

      event.preventDefault()
      pointerBoundsRef.current = event.currentTarget.getBoundingClientRect()
      activePointerRef.current = event.pointerId
      const point = updateToolCursor(event)
      if (!point) {
        activePointerRef.current = null
        return
      }

      const canvasPoint = { x: point[0], y: point[1] }
      const eraserHit =
        activeTool === 'eraser'
          ? getTopmostEditableCanvasObjectAtPoint(
              canvasPoint,
              layersRef.current,
              assetsRef.current,
              strokesRef.current,
              objectOffsetsRef.current,
              assetTransformsRef.current
            )
          : null
      const nextStrokeLayerId = eraserHit?.layerId ?? activeLayerId
      strokeLayerIdRef.current = nextStrokeLayerId
      if (eraserHit && eraserHit.layerId !== activeLayerId) {
        onLayerSelectRef.current?.(eraserHit.layerId)
      }

      event.currentTarget.setPointerCapture?.(event.pointerId)
      pointsRef.current = [point]
      updateDraftPreview(pointsRef.current)
    },
    [activeLayerId, activeTool, canDraw, updateDraftPreview, updateToolCursor]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const point = updateToolCursor(event)
      if (activePointerRef.current !== event.pointerId) {
        return
      }

      if (!point) {
        return
      }

      if (shouldAppendPoint(pointsRef.current, point, brushSize)) {
        pointsRef.current.push(point)
        updateDraftPreview(pointsRef.current)
      }
    },
    [brushSize, updateDraftPreview, updateToolCursor]
  )

  const finishStroke = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== event.pointerId) {
        return
      }

      updateToolCursor(event)
      const finalPath = createSmoothStrokePath(pointsRef.current, brushSize)
      const committedStroke: CanvasStroke = {
        id: crypto.randomUUID(),
        layerId: strokeLayerIdRef.current,
        color,
        size: brushSize,
        path: finalPath,
        tool: activeTool === 'eraser' ? 'eraser' : 'brush',
        points: [...pointsRef.current]
      }

      activePointerRef.current = null
      strokeLayerIdRef.current = activeLayerId
      pointsRef.current = []
      clearDraftPreview()

      if (finalPath) {
        onStrokeCommit(committedStroke)
      }
    },
    [activeLayerId, activeTool, brushSize, clearDraftPreview, color, onStrokeCommit, updateToolCursor]
  )

  const aspect = ratio.replace(':', ' / ')
  const aspectValue = dimensions.width / dimensions.height
  const stageStyle = {
    '--stage-width': `${dimensions.width}px`,
    '--stage-aspect': aspect,
    '--stage-ratio': String(aspectValue),
    ...(fitMode === 'bounded'
      ? {
          width: `min(100cqw, calc(100cqh * ${aspectValue}))`,
          height: `min(100cqh, calc(100cqw / ${aspectValue}))`,
        }
      : {}),
  } as CSSProperties

  const rememberSelectionPoint = useCallback(
    (clientX: number, clientY: number, pressure?: number) => {
      if (activeTool !== 'select') {
        return
      }

      const stage = stageRef.current
      if (!stage) {
        selectionPointRef.current = null
        return
      }

      const point = getCanvasPointFromClient(
        clientX,
        clientY,
        stage.getBoundingClientRect(),
        dimensions,
        pressure
      )
      selectionPointRef.current = { x: point[0], y: point[1] }
    },
    [activeTool, dimensions]
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const handlePointerEvent = (event: PointerEvent) => {
      rememberSelectionPoint(event.clientX, event.clientY, event.pressure)
    }

    stage.addEventListener('pointerdown', handlePointerEvent, true)
    stage.addEventListener('pointermove', handlePointerEvent, true)

    return () => {
      stage.removeEventListener('pointerdown', handlePointerEvent, true)
      stage.removeEventListener('pointermove', handlePointerEvent, true)
    }
  }, [rememberSelectionPoint])

  const handleStagePointerCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      rememberSelectionPoint(event.clientX, event.clientY, event.pressure)
    },
    [rememberSelectionPoint]
  )

  const setMultiSelectionOutlineOffset = useCallback((offset: CanvasPoint | null) => {
    const outline = multiSelectionOutlineRef.current
    if (!outline) {
      return
    }

    if (!offset || (offset.x === 0 && offset.y === 0)) {
      outline.removeAttribute('transform')
      return
    }

    outline.setAttribute('transform', `translate(${offset.x} ${offset.y})`)
  }, [])

  const moveCanvasTargetsByDelta = useCallback((targets: CanvasObjectTarget[], delta: CanvasPoint) => {
    if (delta.x === 0 && delta.y === 0) {
      return
    }

    const movedKeys = new Set<string>()

    for (const target of targets) {
      const key = getObjectKey(target.kind, target.id)
      if (movedKeys.has(key)) {
        continue
      }
      movedKeys.add(key)

      const offset = objectOffsetsRef.current.get(key) ?? { x: 0, y: 0 }
      objectOffsetsRef.current.set(key, {
        x: offset.x + delta.x,
        y: offset.y + delta.y
      })

      if (target.kind === 'asset') {
        const asset = assetsRef.current.find((item) => item.id === target.id)
        const currentTransform = assetTransformsRef.current.get(target.id)

        if (asset && currentTransform) {
          assetTransformsRef.current.set(target.id, {
            ...currentTransform,
            x: currentTransform.x + delta.x,
            y: currentTransform.y + delta.y
          })
        }
      }

      const node = canvasObjectNodesRef.current.get(key)
      if (node) {
        const mutableNode = node as LeaferBox & { x?: number; y?: number }
        const nodeBounds = getCanvasNodeBounds(node)
        mutableNode.x = getFiniteNumber(mutableNode.x ?? Number.NaN, nodeBounds.x ?? 0) + delta.x
        mutableNode.y = getFiniteNumber(mutableNode.y ?? Number.NaN, nodeBounds.y ?? 0) + delta.y
      }
    }
  }, [])

  const finishMultiSelectionDrag = useCallback(
    (pointerId: number) => {
      const dragState = multiSelectionDragRef.current
      if (!dragState || dragState.pointerId !== pointerId) {
        return false
      }

      const stage = stageRef.current
      if (stage?.hasPointerCapture?.(pointerId)) {
        stage.releasePointerCapture?.(pointerId)
      }

      multiSelectionDragRef.current = null
      setMultiSelectionOutlineOffset(null)

      if (dragState.totalDelta.x !== 0 || dragState.totalDelta.y !== 0) {
        setRenderReadyVersion((version) => version + 1)
      }

      return true
    },
    [setMultiSelectionOutlineOffset]
  )

  const clearBoxSelectionInteraction = useCallback(() => {
    const pointerId = boxSelectPointerRef.current
    const stage = stageRef.current
    if (pointerId !== null && stage?.hasPointerCapture?.(pointerId)) {
      stage.releasePointerCapture?.(pointerId)
    }

    boxSelectPointerRef.current = null
    boxSelectStartRef.current = null
    boxSelectCurrentRef.current = null
    isBoxSelectingRef.current = false
    setSelectionBox(null)
  }, [])

  const getCanvasPointFromStagePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): CanvasPoint | null => {
      const stage = stageRef.current
      if (!stage) {
        return null
      }

      const point = getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        stage.getBoundingClientRect(),
        dimensions,
        event.pressure
      )

      return { x: point[0], y: point[1] }
    },
    [dimensions]
  )

  const finishBoxSelection = useCallback(
    (pointerId: number, clientX: number, clientY: number, pressure?: number) => {
      if (boxSelectPointerRef.current !== pointerId) {
        return false
      }

      const wasBoxSelecting = isBoxSelectingRef.current
      const startPoint = boxSelectStartRef.current
      const stage = stageRef.current
      const pointerPoint =
        stage && startPoint
          ? getCanvasPointFromClient(clientX, clientY, stage.getBoundingClientRect(), dimensions, pressure)
          : null
      const currentPoint = pointerPoint
        ? { x: pointerPoint[0], y: pointerPoint[1] }
        : boxSelectCurrentRef.current
      if (stage?.hasPointerCapture?.(pointerId)) {
        stage.releasePointerCapture?.(pointerId)
      }
      boxSelectPointerRef.current = null
      boxSelectStartRef.current = null
      boxSelectCurrentRef.current = null
      isBoxSelectingRef.current = false
      setSelectionBox(null)

      if (!wasBoxSelecting || !startPoint || !currentPoint) {
        return false
      }

      const selectedTargets = getSelectableCanvasObjectsInBounds(
        normalizeCanvasBounds(startPoint, currentPoint),
        layersRef.current,
        assetsRef.current,
        strokesRef.current,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )

      if (selectedTargets.length < 2) {
        multiSelectedObjectTargetsRef.current = []
      }
      updateSelectedObjectTargets(selectedTargets)
      renderContextRef.current?.app.editor.cancel?.()

      if (selectedTargets.length === 1) {
        const layerId = getLayerIdForCanvasObject(selectedTargets[0], assetsRef.current, strokesRef.current)
        if (layerId) {
          activeObjectTargetRef.current = selectedTargets[0]
          onLayerSelectRef.current?.(layerId)
          onObjectSelectRef.current?.(selectedTargets[0], layerId)
        }
      }

      return true
    },
    [dimensions, updateSelectedObjectTargets]
  )

  const updateBoxSelectionDrag = useCallback(
    (pointerId: number, currentPoint: CanvasPoint) => {
      const startPoint = boxSelectStartRef.current
      if (boxSelectPointerRef.current !== pointerId || !startPoint) {
        return false
      }

      boxSelectCurrentRef.current = currentPoint

      if (!isBoxSelectingRef.current) {
        isBoxSelectingRef.current = true
        stageRef.current?.setPointerCapture?.(pointerId)
        renderContextRef.current?.app.editor.cancel?.()
        setContextMenu(null)
        updateSelectedObjectTargets([])
      }

      setSelectionBox({
        start: startPoint,
        current: currentPoint
      })

      return true
    },
    [updateSelectedObjectTargets]
  )

  const handleStagePointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCanvasContextMenuEvent(event.nativeEvent)) {
        return
      }

      handleStagePointerCapture(event)

      if (activeTool !== 'select') {
        return
      }

      if (event.button > 0) {
        event.stopPropagation()
        return
      }

      const startPoint = getCanvasPointFromStagePointer(event)
      if (!startPoint) {
        return
      }

      const selectedTargets = selectedObjectTargetsRef.current
      const stageBounds = event.currentTarget.getBoundingClientRect()
      if (
        isPointNearSingleAssetResizeHandle(
          startPoint,
          selectedTargets,
          layersRef.current,
          assetsRef.current,
          strokesRef.current,
          objectOffsetsRef.current,
          assetTransformsRef.current,
          getCanvasHitRadiusFromStageBounds(dimensions, stageBounds)
        )
      ) {
        clearBoxSelectionInteraction()
        return
      }

      const selectedGroupBounds =
        selectedTargets.length > 1
          ? getCanvasTargetsUnionBounds(
              selectedTargets,
              layersRef.current,
              assetsRef.current,
              strokesRef.current,
              objectOffsetsRef.current,
              assetTransformsRef.current
            )
          : null
      const hit = getTopmostEditableCanvasObjectAtPoint(
        startPoint,
        layersRef.current,
        assetsRef.current,
        strokesRef.current,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )

      const hitIsSelected = hit
        ? selectedTargets.some((target) => areCanvasTargetsEqual(target, hit.target))
        : false

      if (
        selectedTargets.length > 1 &&
        selectedGroupBounds &&
        isPointInsideBounds(startPoint, selectedGroupBounds) &&
        (!hit || hitIsSelected)
      ) {
        clearBoxSelectionInteraction()
        multiSelectionDragRef.current = {
          pointerId: event.pointerId,
          lastPoint: startPoint,
          totalDelta: { x: 0, y: 0 },
          targets: selectedTargets
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        renderContextRef.current?.app.editor.cancel?.()
        setContextMenu(null)
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (hit) {
        clearBoxSelectionInteraction()
        return
      }

      boxSelectStartRef.current = startPoint
      boxSelectCurrentRef.current = startPoint
      boxSelectPointerRef.current = event.pointerId
      isBoxSelectingRef.current = false
    },
    [
      activeTool,
      clearBoxSelectionInteraction,
      dimensions,
      getCanvasPointFromStagePointer,
      handleStagePointerCapture,
      updateSelectedObjectTargets
    ]
  )

  const handleStagePointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCanvasContextMenuEvent(event.nativeEvent)) {
        return
      }

      handleStagePointerCapture(event)

      const multiDragState = multiSelectionDragRef.current
      if (multiDragState && multiDragState.pointerId === event.pointerId) {
        if (event.buttons === 0) {
          finishMultiSelectionDrag(event.pointerId)
          return
        }

        const currentPoint = getCanvasPointFromStagePointer(event)
        if (!currentPoint) {
          return
        }

        const delta = {
          x: currentPoint.x - multiDragState.lastPoint.x,
          y: currentPoint.y - multiDragState.lastPoint.y
        }

        if (delta.x !== 0 || delta.y !== 0) {
          moveCanvasTargetsByDelta(multiDragState.targets, delta)
          multiDragState.lastPoint = currentPoint
          multiDragState.totalDelta = {
            x: multiDragState.totalDelta.x + delta.x,
            y: multiDragState.totalDelta.y + delta.y
          }
          setMultiSelectionOutlineOffset(multiDragState.totalDelta)
        }

        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (boxSelectPointerRef.current !== event.pointerId || !boxSelectStartRef.current) {
        return
      }

      if (event.buttons === 0) {
        clearBoxSelectionInteraction()
        return
      }

      const currentPoint = getCanvasPointFromStagePointer(event)
      if (!currentPoint) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      updateBoxSelectionDrag(event.pointerId, currentPoint)
    },
    [
      clearBoxSelectionInteraction,
      finishMultiSelectionDrag,
      getCanvasPointFromStagePointer,
      handleStagePointerCapture,
      moveCanvasTargetsByDelta,
      setMultiSelectionOutlineOffset,
      updateBoxSelectionDrag
    ]
  )

  const handleStagePointerUpCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCanvasContextMenuEvent(event.nativeEvent)) {
        return
      }

      handleStagePointerCapture(event)

      if (finishMultiSelectionDrag(event.pointerId)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (finishBoxSelection(event.pointerId, event.clientX, event.clientY, event.pressure)) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [finishBoxSelection, finishMultiSelectionDrag, handleStagePointerCapture]
  )

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (boxSelectPointerRef.current !== event.pointerId || !boxSelectStartRef.current) {
        return
      }

      if (event.buttons === 0) {
        clearBoxSelectionInteraction()
        return
      }

      const stage = stageRef.current
      if (!stage) {
        return
      }

      const point = getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        stage.getBoundingClientRect(),
        dimensions,
        event.pressure
      )
      const currentPoint = { x: point[0], y: point[1] }
      updateBoxSelectionDrag(event.pointerId, currentPoint)
    }
    const handleWindowPointerDone = (event: PointerEvent) => {
      if (finishMultiSelectionDrag(event.pointerId)) {
        return
      }

      finishBoxSelection(event.pointerId, event.clientX, event.clientY, event.pressure)
    }
    const handleWindowBlur = () => {
      const dragState = multiSelectionDragRef.current
      if (dragState) {
        finishMultiSelectionDrag(dragState.pointerId)
      }

      clearBoxSelectionInteraction()
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerDone)
    window.addEventListener('pointercancel', handleWindowPointerDone)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerDone)
      window.removeEventListener('pointercancel', handleWindowPointerDone)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [
    clearBoxSelectionInteraction,
    dimensions,
    finishBoxSelection,
    finishMultiSelectionDrag,
    updateBoxSelectionDrag
  ])

  return (
    <div
      className={[
        'touch-none overflow-hidden border border-nomi-line bg-[var(--canvas)] shadow-nomi-lg [aspect-ratio:var(--stage-aspect)]',
        fitMode === 'bounded'
          ? 'rounded-nomi'
          : 'rounded-nomi [width:min(100%,var(--stage-width),calc(100cqh_*_var(--stage-ratio)))]',
      ].join(' ')}
      style={stageStyle}
    >
      <div
        ref={stageRef}
        className="relative h-full w-full"
        onContextMenu={showContextMenu}
        onPointerDownCapture={handleStagePointerDownCapture}
        onPointerMoveCapture={handleStagePointerMoveCapture}
        onPointerUpCapture={handleStagePointerUpCapture}
        onPointerCancelCapture={handleStagePointerUpCapture}
      >
        <div
          ref={hostRef}
          className="h-full w-full overflow-hidden [&_.leafer-app-view]:!block [&_.leafer-app-view]:!h-full [&_.leafer-app-view]:!max-h-full [&_.leafer-app-view]:!max-w-full [&_.leafer-app-view]:!w-full [&_canvas]:!block [&_canvas]:!h-full [&_canvas]:!max-h-full [&_canvas]:!max-w-full [&_canvas]:!w-full"
          aria-label="Leafer 画板"
        />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          data-testid="draft-layer"
          aria-hidden="true"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="none"
        >
          <g ref={snapGuideGroupRef} className="pointer-events-none" style={{ display: 'none' }} />
          {selectionBox ? (
            <rect
              className="fill-[rgba(24,199,184,0.12)] stroke-[var(--accent-strong)] [stroke-dasharray:8_6] [stroke-width:1.5]"
              data-testid="box-select-rect"
              vectorEffect="non-scaling-stroke"
              {...getSvgRectAttributes(normalizeCanvasBounds(selectionBox.start, selectionBox.current))}
            />
          ) : null}
          {selectedObjectTargets.length > 1 ? (
            <rect
              ref={multiSelectionOutlineRef}
              className="fill-transparent stroke-[var(--accent-strong)] [filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.24))] [stroke-dasharray:7_5] [stroke-width:1.8]"
              data-testid="multi-selected-outline"
              vectorEffect="non-scaling-stroke"
              {...getSvgRectAttributes(
                getCanvasTargetsUnionBounds(
                  selectedObjectTargets,
                  layers,
                  assets,
                  strokes,
                  objectOffsetsRef.current,
                  assetTransformsRef.current
                ) ?? { x: 0, y: 0, width: 1, height: 1 }
              )}
            />
          ) : null}
          {activeTool === 'brush' ? (
            <path ref={draftPathRef} fill={color} style={{ display: 'none' }} />
          ) : null}
          {activeTool === 'eraser' ? (
            <g ref={cursorGroupRef} data-testid="tool-cursor-preview" style={{ display: 'none' }}>
              <circle
                ref={eraserHaloRef}
                cx="0"
                cy="0"
                r={brushSize / 2}
                fill="rgba(251,251,250,0.22)"
                stroke="rgba(255,255,255,0.95)"
                strokeWidth="6"
              />
              <circle
                ref={eraserOutlineRef}
                cx="0"
                cy="0"
                r={brushSize / 2}
                fill="none"
                stroke="rgba(15,23,42,0.88)"
                strokeDasharray="10 6"
                strokeWidth="2.4"
              />
            </g>
          ) : null}
        </svg>
        <div
          ref={pointerLayerRef}
          className={`absolute inset-0 cursor-crosshair ${
            activeTool === 'select' ? 'pointer-events-none cursor-default' : ''
          } ${activeTool === 'eraser' ? 'cursor-none' : ''}`}
          role="application"
          aria-label="绘图操作层"
          onPointerDown={handlePointerDown}
          onPointerEnter={updateToolCursor}
          onPointerLeave={hideToolCursor}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        />
        {contextMenu ? (
          <div
            className="absolute z-20 grid w-[124px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper p-1 text-body-sm text-nomi-ink shadow-nomi-lg [&>button]:h-8 [&>button]:rounded-nomi-sm [&>button]:bg-transparent [&>button]:px-2 [&>button]:text-left [&>button]:text-inherit [&>button]:transition [&>button]:duration-150 [&>button]:ease-out [&>button:focus-visible]:bg-nomi-accent-soft [&>button:focus-visible]:text-nomi-accent [&>button:focus-visible]:outline-none [&>button:hover]:bg-nomi-accent-soft [&>button:hover]:text-nomi-accent"
            data-canvas-context-menu="true"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y } as CSSProperties}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {contextMenu.targets.length > 1 ? (
              <button
                type="button"
                role="menuitem"
                onPointerDown={handleGroupMenuPointerDown}
                onPointerUp={handleGroupMenuPointerUp}
                onMouseDown={handleGroupMenuMouseDown}
                onClick={handleGroupMenuClick}
              >
                组合
              </button>
            ) : null}
            {contextMenu.targets.length === 1 ? (
              <>
                <button type="button" role="menuitem" onClick={() => flipSelectedTarget('x')}>
                  水平翻转
                </button>
                <button type="button" role="menuitem" onClick={() => flipSelectedTarget('y')}>
                  垂直翻转
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
})
