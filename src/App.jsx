import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfigPanel } from './components/ConfigPanel'
import { ImageWorkspace } from './components/ImageWorkspace'
import { StopModal } from './components/StopModal'
import { APP_CONFIG } from './config/appConfig'
import {
  calculateHeightForWidth,
  calculateWidthForHeight,
} from './utils/imageSizing'
import { clamp, numberValue } from './utils/math'

const initialSettings = APP_CONFIG.defaults
const MIN_WORKSPACE_IMAGE_RATIO = 0.3
const MAX_ZOOM = 16

function calculateMinZoom(workspace, targetSize) {
  const rect = workspace?.getBoundingClientRect()
  if (!rect?.width || !rect?.height || !targetSize.width || !targetSize.height) return 0.05

  return Math.min(
    MAX_ZOOM,
    (rect.width * MIN_WORKSPACE_IMAGE_RATIO) / targetSize.width,
    (rect.height * MIN_WORKSPACE_IMAGE_RATIO) / targetSize.height,
  )
}

function sanitizeSettings(settings) {
  const useFastSolving = Boolean(settings.useFastSolving)

  return {
    ...settings,
    useFastSolving,
    startX: Math.round(numberValue(settings.startX)),
    startY: Math.round(numberValue(settings.startY)),
    startZ: Math.round(numberValue(settings.startZ)),
    layerDirection: Number(settings.layerDirection) === -1 ? -1 : 1,
    layerStepBlocks: Math.max(1, Math.round(numberValue(settings.layerStepBlocks, 0)) + 1),
    mirrorImageWidthAxis: !settings.mirrorImageWidthAxis,
    commandLimit: Math.max(1, Math.round(numberValue(settings.commandLimit, 20_000))),
    resultWidth: Math.max(1, Math.round(numberValue(settings.resultWidth, 1))),
    resultHeight: Math.max(1, Math.round(numberValue(settings.resultHeight, 1))),
    skipTransparentPixels: true,
    transparentAlphaThreshold: Math.round(numberValue(settings.transparentAlphaThreshold)),
    cleanTransparentResizeEdges: true,
    buildMaskCoverageThreshold: Math.round(numberValue(settings.buildMaskCoverageThreshold, 128)),
    imageMaxColors: Math.max(0, Math.round(numberValue(settings.imageMaxColors))),
    minLayers: Math.max(0, Math.round(numberValue(settings.minLayers))),
    maxLayers: useFastSolving ? 6 : Math.max(1, Math.round(numberValue(settings.maxLayers))),
    perColorBeamWidth: Math.max(1, Math.round(numberValue(settings.perColorBeamWidth, 96))),
    solverColorBinSize: Math.max(1, Math.round(numberValue(settings.solverColorBinSize, 2))),
    newLayerMinImprovement: Math.max(0, numberValue(settings.newLayerMinImprovement, 0.35)),
    newLayerMinColorDelta: Math.max(0, numberValue(settings.newLayerMinColorDelta, 0.35)),
    perfectMatchDistance: Math.max(0, numberValue(settings.perfectMatchDistance, 0.01)),
    baseBlockRgb: settings.baseBlockRgb.map((value) => Math.round(clamp(numberValue(value), 0, 255))),
    alphaBackgroundRgb: settings.alphaBackgroundRgb.map((value) =>
      Math.round(clamp(numberValue(value), 0, 255)),
    ),
  }
}

function createDownloadUrl(blob) {
  return URL.createObjectURL(blob)
}

function App() {
  const [settings, setSettings] = useState(initialSettings)
  const [image, setImage] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const [isViewAnimating, setIsViewAnimating] = useState(false)
  const [minZoom, setMinZoom] = useState(0.05)
  const [generation, setGeneration] = useState({ status: 'idle', progress: 0, label: '' })
  const [stopModalOpen, setStopModalOpen] = useState(false)
  const [download, setDownload] = useState(null)
  const [stats, setStats] = useState(null)
  const [runtimeError, setRuntimeError] = useState('')

  const fileRef = useRef(null)
  const fileInputRef = useRef(null)
  const workspaceRef = useRef(null)
  const panStartRef = useRef(null)
  const workerRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const overlayImageRef = useRef(null)
  const downloadUrlRef = useRef('')
  const animationTimeoutRef = useRef(null)

  const targetSize = useMemo(
    () => ({
      width: Math.max(1, Math.round(numberValue(settings.resultWidth, 1))),
      height: Math.max(1, Math.round(numberValue(settings.resultHeight, 1))),
    }),
    [settings.resultHeight, settings.resultWidth],
  )

  const validation = useMemo(() => {
    const errors = []

    if (!image) errors.push('Import an image before generating.')
    if (!settings.schematicFileName.trim()) errors.push('Schematic file name is required.')
    if (targetSize.width < 1 || targetSize.height < 1) errors.push('Image resolution must be positive.')
    if (!settings.useFastSolving && numberValue(settings.maxLayers) < numberValue(settings.minLayers)) {
      errors.push('Max layers must be at least 1.')
    }
    if (!settings.useFastSolving && !settings.glassColorNames.length) {
      errors.push('At least one color must be enabled.')
    }
    return errors
  }, [image, settings, targetSize.height, targetSize.width])

  const updateSetting = useCallback((key, value) => {
    setSettings((current) => {
      if (key !== 'lockAspectRatio') return { ...current, [key]: value }

      const lockAspectRatio = Boolean(value)
      if (!lockAspectRatio || !image) return { ...current, lockAspectRatio }

      const resultHeight = Math.max(1, Math.round(numberValue(current.resultHeight, 1)))
      return {
        ...current,
        lockAspectRatio,
        resultHeight,
        resultWidth: calculateWidthForHeight(image, resultHeight),
      }
    })
  }, [image])

  const updateDimension = useCallback(
    (key, value) => {
      const nextValue = Math.max(1, Math.round(numberValue(value, 1)))
      setSettings((current) => {
        if (!current.lockAspectRatio || !image) return { ...current, [key]: nextValue }
        if (key === 'resultWidth') {
          return { ...current, resultWidth: nextValue, resultHeight: calculateHeightForWidth(image, nextValue) }
        }
        return { ...current, resultHeight: nextValue, resultWidth: calculateWidthForHeight(image, nextValue) }
      })
    },
    [image],
  )

  const clearDownload = useCallback(() => {
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current)
      downloadUrlRef.current = ''
    }
    setDownload(null)
  }, [])

  const importFile = useCallback(
    async (file) => {
      if (!file?.type.startsWith('image/')) return
      const bitmap = await createImageBitmap(file)
      const nextImage = { name: file.name || 'clipboard-image.png', width: bitmap.width, height: bitmap.height }
      const preferredHeight = Math.max(1, Math.round(numberValue(settings.resultHeight, APP_CONFIG.defaults.resultHeight)))
      const fittedSize = settings.lockAspectRatio
        ? { width: calculateWidthForHeight(nextImage, preferredHeight), height: preferredHeight }
        : {
            width: Math.max(1, Math.round(numberValue(settings.resultWidth, APP_CONFIG.defaults.resultWidth))),
            height: preferredHeight,
          }
      fileRef.current = file
      setImage(nextImage)
      setSettings((current) => ({
        ...current,
        resultWidth: fittedSize.width,
        resultHeight: fittedSize.height,
      }))
      setPan({ x: 0, y: 0 })
      setZoom(1)
      setStats(null)
      setRuntimeError('')
      clearDownload()
      bitmap.close?.()
    },
    [clearDownload, settings.lockAspectRatio, settings.resultHeight, settings.resultWidth],
  )

  const removeImage = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    fileRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
    setImage(null)
    setPreviewUrl('')
    setStats(null)
    setRuntimeError('')
    setGeneration({ status: 'idle', progress: 0, label: '' })
    clearDownload()
    const canvas = overlayCanvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }, [clearDownload])

  useEffect(() => {
    if (!image || !fileRef.current) return undefined

    let disposed = false

    async function renderPreview() {
      const bitmap = await createImageBitmap(fileRef.current)
      const canvas = document.createElement('canvas')
      canvas.width = targetSize.width
      canvas.height = targetSize.height
      const context = canvas.getContext('2d')
      context.imageSmoothingEnabled = settings.resizeFilter !== 'NEAREST'
      context.imageSmoothingQuality = settings.resizeFilter === 'LANCZOS' ? 'high' : 'medium'
      if (settings.mirrorImageWidthAxis) {
        context.translate(targetSize.width, 0)
        context.scale(-1, 1)
      }
      context.drawImage(bitmap, 0, 0, targetSize.width, targetSize.height)
      const nextPreviewUrl = canvas.toDataURL('image/png')
      if (!disposed) setPreviewUrl(nextPreviewUrl)
      bitmap.close?.()
    }

    renderPreview().catch((error) => setRuntimeError(error.message))
    return () => {
      disposed = true
    }
  }, [image, settings.mirrorImageWidthAxis, settings.resizeFilter, targetSize.height, targetSize.width])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || !image) return undefined

    function updateMinZoom() {
      const nextMinZoom = calculateMinZoom(workspace, {
        width: targetSize.width,
        height: targetSize.height,
      })
      setMinZoom(nextMinZoom)
      setZoom((current) => clamp(current, nextMinZoom, MAX_ZOOM))
    }

    updateMinZoom()
    const observer = new ResizeObserver(updateMinZoom)
    observer.observe(workspace)

    return () => observer.disconnect()
  }, [image, targetSize.height, targetSize.width])

  useEffect(() => {
    function handlePaste(event) {
      const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/'))
      if (file) importFile(file)
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [importFile])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      window.clearTimeout(animationTimeoutRef.current)
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current)
    },
    [],
  )

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault()
      setIsDraggingOver(false)
      const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('image/'))
      if (file) importFile(file)
    },
    [importFile],
  )

  const startGeneration = useCallback(async () => {
    if (validation.length || !fileRef.current) return

    const overlayCanvas = overlayCanvasRef.current
    const previousResult = download
      ? {
          download,
          stats,
          overlay:
            overlayCanvas.width > 0 && overlayCanvas.height > 0
              ? overlayCanvas.getContext('2d').getImageData(0, 0, overlayCanvas.width, overlayCanvas.height)
              : null,
          overlayWidth: overlayCanvas.width,
          overlayHeight: overlayCanvas.height,
        }
      : null

    setRuntimeError('')
    setGeneration({ status: 'running', progress: 0, label: 'Preparing image' })
    const generationSettings = sanitizeSettings(settings)
    const shouldMirrorOverlay = generationSettings.mirrorImageWidthAxis !== settings.mirrorImageWidthAxis

    overlayCanvas.width = targetSize.width
    overlayCanvas.height = targetSize.height
    const overlayContext = overlayCanvas.getContext('2d')
    overlayImageRef.current = overlayContext.createImageData(targetSize.width, targetSize.height)
    overlayContext.clearRect(0, 0, targetSize.width, targetSize.height)

    workerRef.current?.terminate()
    const worker = new Worker(new URL('./worker/generator.worker.js', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (event) => {
      const message = event.data

      if (message.type === 'prepared') {
        setGeneration({
          status: 'running',
          progress: 3,
          label: `${message.uniqueColors} unique colors, ${message.buildablePixels} buildable pixels`,
        })
      }

      if (message.type === 'overlay') {
        const imageData = overlayImageRef.current
        if (imageData) {
          for (let index = 0; index < message.indexes.length; index += 1) {
            const pixelIndex = message.indexes[index]
            const displayPixelIndex = shouldMirrorOverlay
              ? Math.floor(pixelIndex / targetSize.width) * targetSize.width +
                (targetSize.width - 1 - (pixelIndex % targetSize.width))
              : pixelIndex
            const colorIndex = index * 3
            const offset = displayPixelIndex * 4
            imageData.data[offset] = message.colors[colorIndex]
            imageData.data[offset + 1] = message.colors[colorIndex + 1]
            imageData.data[offset + 2] = message.colors[colorIndex + 2]
            imageData.data[offset + 3] = 255
          }
          overlayCanvas.getContext('2d').putImageData(imageData, 0, 0)
        }

        setGeneration({
          status: 'running',
          progress: Math.max(5, Math.round((message.solvedColors / message.uniqueColors) * 94)),
          label: message.label || `Solved ${message.solvedColors} of ${message.uniqueColors} colors`,
        })
      }

      if (message.type === 'done') {
        const url = createDownloadUrl(message.schematicBlob)
        if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current)
        downloadUrlRef.current = url
        setDownload({ url, fileName: message.fileName })
        setStats(message.stats)
        setGeneration({ status: 'done', progress: 100, label: 'Schematic ready' })
        worker.terminate()
        workerRef.current = null
      }

      if (message.type === 'cancelled') {
        if (previousResult?.overlay) {
          overlayCanvas.width = previousResult.overlayWidth
          overlayCanvas.height = previousResult.overlayHeight
          overlayImageRef.current = previousResult.overlay
          overlayCanvas.getContext('2d').putImageData(previousResult.overlay, 0, 0)
        } else {
          overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
          overlayImageRef.current = null
        }
        setDownload(previousResult?.download ?? null)
        setStats(previousResult?.stats ?? null)
        setGeneration(
          previousResult
            ? { status: 'done', progress: 100, label: 'Schematic ready' }
            : { status: 'idle', progress: 0, label: '' },
        )
        worker.terminate()
        workerRef.current = null
      }

      if (message.type === 'error') {
        setRuntimeError(message.message)
        setGeneration({ status: 'idle', progress: 0, label: '' })
        worker.terminate()
        workerRef.current = null
      }
    }

    const fileBuffer = await fileRef.current.arrayBuffer()
    worker.postMessage({
      type: 'generate',
      fileBuffer,
      fileType: fileRef.current.type,
      settings: generationSettings,
    })
  }, [download, settings, stats, targetSize.height, targetSize.width, validation])

  const confirmStop = useCallback(() => {
    workerRef.current?.postMessage({ type: 'cancel' })
    setStopModalOpen(false)
    setGeneration((current) => ({ ...current, label: 'Stopping after current color batch' }))
  }, [])

  const toggleGlassColor = useCallback((colorName, checked) => {
    setSettings((current) => ({
      ...current,
      glassColorNames: checked
        ? [...current.glassColorNames, colorName]
        : current.glassColorNames.filter((name) => name !== colorName),
    }))
  }, [])

  const fitImageToWorkspace = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace || !image) return

    const rect = workspace.getBoundingClientRect()
    const nextZoom = clamp(
      Math.min((rect.width * 0.9) / targetSize.width, (rect.height * 0.9) / targetSize.height),
      minZoom,
      MAX_ZOOM,
    )

    window.clearTimeout(animationTimeoutRef.current)
    setIsViewAnimating(true)
    setPan({ x: 0, y: 0 })
    setZoom(nextZoom)
    animationTimeoutRef.current = window.setTimeout(() => setIsViewAnimating(false), 320)
  }, [image, minZoom, targetSize.height, targetSize.width])

  const handleWheel = useCallback(
    (event) => {
      if (!image) return
      event.preventDefault()

      const workspace = workspaceRef.current
      if (!workspace) return

      const rect = workspace.getBoundingClientRect()
      const nextZoom = clamp(zoom * Math.exp(-event.deltaY * 0.0015), minZoom, MAX_ZOOM)
      const focalX = (event.clientX - rect.left - rect.width / 2 - pan.x) / zoom
      const focalY = (event.clientY - rect.top - rect.height / 2 - pan.y) / zoom

      window.clearTimeout(animationTimeoutRef.current)
      setIsViewAnimating(true)
      setZoom(nextZoom)
      setPan({
        x: event.clientX - rect.left - rect.width / 2 - focalX * nextZoom,
        y: event.clientY - rect.top - rect.height / 2 - focalY * nextZoom,
      })
      animationTimeoutRef.current = window.setTimeout(() => setIsViewAnimating(false), 140)
    },
    [image, minZoom, pan.x, pan.y, zoom],
  )

  const handleDoubleClick = useCallback(
    (event) => {
      if (!image || event.button !== 0) return
      event.preventDefault()

      const workspace = workspaceRef.current
      if (!workspace) return

      const rect = workspace.getBoundingClientRect()
      const nextZoom = clamp(zoom * 1.6, minZoom, MAX_ZOOM)
      const focalX = (event.clientX - rect.left - rect.width / 2 - pan.x) / zoom
      const focalY = (event.clientY - rect.top - rect.height / 2 - pan.y) / zoom

      window.clearTimeout(animationTimeoutRef.current)
      setIsViewAnimating(true)
      setZoom(nextZoom)
      setPan({
        x: event.clientX - rect.left - rect.width / 2 - focalX * nextZoom,
        y: event.clientY - rect.top - rect.height / 2 - focalY * nextZoom,
      })
      animationTimeoutRef.current = window.setTimeout(() => setIsViewAnimating(false), 220)
    },
    [image, minZoom, pan.x, pan.y, zoom],
  )

  const pointerDown = useCallback(
    (event) => {
      if (!image) return
      setIsPanning(true)
      panStartRef.current = { x: event.clientX - pan.x, y: event.clientY - pan.y }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [image, pan.x, pan.y],
  )

  const pointerMove = useCallback((event) => {
    if (!panStartRef.current) return
    setPan({ x: event.clientX - panStartRef.current.x, y: event.clientY - panStartRef.current.y })
  }, [])

  const pointerUp = useCallback((event) => {
    setIsPanning(false)
    panStartRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  const isRunning = generation.status === 'running'
  const canGenerate = validation.length === 0 && !isRunning

  return (
    <main className="h-svh overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)] lg:grid-rows-1">
        <ImageWorkspace
          workspaceRef={workspaceRef}
          image={image}
          previewUrl={previewUrl}
          targetSize={targetSize}
          isRunning={isRunning}
          isDraggingOver={isDraggingOver}
          isPanning={isPanning}
          isViewAnimating={isViewAnimating}
          pan={pan}
          zoom={zoom}
          minZoom={minZoom}
          maxZoom={MAX_ZOOM}
          overlayCanvasRef={overlayCanvasRef}
          fileInputRef={fileInputRef}
          onImportFile={importFile}
          onDrop={handleDrop}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDraggingOver(true)
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
          onFitView={fitImageToWorkspace}
          onRemoveImage={removeImage}
          onZoomChange={(value) => setZoom(clamp(value, minZoom, MAX_ZOOM))}
        />

        <ConfigPanel
          settings={settings}
          validation={validation}
          runtimeError={runtimeError}
          generation={generation}
          download={download}
          stats={stats}
          isRunning={isRunning}
          canGenerate={canGenerate}
          onSettingChange={updateSetting}
          onDimensionChange={updateDimension}
          onToggleGlassColor={toggleGlassColor}
          onGenerate={startGeneration}
          onStopRequest={() => setStopModalOpen(true)}
        />
      </div>

      <StopModal open={stopModalOpen} onClose={() => setStopModalOpen(false)} onConfirm={confirmStop} />
    </main>
  )
}

export default App
