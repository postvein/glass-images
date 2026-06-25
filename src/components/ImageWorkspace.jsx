import { FolderOpen, Hand, ImagePlus, Maximize2, X } from 'lucide-react'
import { Button } from './FormControls'

export function ImageWorkspace({
  workspaceRef,
  image,
  previewUrl,
  targetSize,
  isRunning,
  isDraggingOver,
  isPanning,
  isViewAnimating,
  pan,
  zoom,
  minZoom,
  maxZoom,
  overlayCanvasRef,
  fileInputRef,
  onImportFile,
  onDrop,
  onDragOver,
  onDragLeave,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onDoubleClick,
  onFitView,
  onRemoveImage,
  onZoomChange,
}) {
  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  return (
    <section
      ref={workspaceRef}
      className={`relative z-0 h-full min-h-0 overflow-hidden border-b border-zinc-800 bg-[radial-gradient(circle_at_center,#27272a_1px,transparent_1px)] [background-size:24px_24px] lg:border-b-0 lg:border-r ${isDraggingOver ? 'ring-2 ring-inset ring-violet-400' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300 backdrop-blur">
        <Hand className="h-4 w-4" />
        {image ? `${targetSize.width} x ${targetSize.height} blocks` : 'Image workspace'}
      </div>

      {image ? (
        <>
          <button
            type="button"
            onClick={onRemoveImage}
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute right-4 top-4 z-20 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-zinc-700 bg-zinc-950/80 text-sm text-zinc-100 backdrop-blur transition hover:border-red-300 hover:text-red-100"
          aria-label="Remove image"
          title="Remove image"
        >
            <X className="h-5 w-5" />
          </button>
          <div
            className={`absolute left-1/2 top-1/2 origin-center ${isViewAnimating ? 'transition-transform duration-300 ease-out' : ''}`}
            style={{
              width: targetSize.width,
              height: targetSize.height,
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
              cursor: isPanning ? 'grabbing' : 'grab',
            }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={image.name}
                className={`absolute inset-0 h-full w-full select-none object-fill [image-rendering:pixelated] ${isRunning ? 'opacity-25' : 'opacity-100'}`}
                draggable="false"
              />
            ) : null}
            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 h-full w-full [image-rendering:pixelated]"
              aria-hidden="true"
            />
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={openFilePicker}
          className="absolute left-1/2 top-1/2 grid w-[min(520px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 place-items-center gap-4 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/80 px-8 py-12 text-center shadow-2xl outline-none transition hover:border-violet-400 focus-visible:border-violet-400"
        >
          <ImagePlus className="h-10 w-10 text-violet-300" />
          <span className="text-lg font-medium text-zinc-100">Drop an image here</span>
          <span className="max-w-sm text-sm leading-6 text-zinc-400">
            Drag an image, paste one with Cmd/Ctrl + V, or open it from files explorer.
          </span>
        </button>
      )}

      <div
        className="absolute bottom-4 left-4 z-20 flex flex-col items-center gap-2.5"
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <Button
          type="button"
          onClick={openFilePicker}
          className="h-10 w-10 px-0 [&_svg]:h-5 [&_svg]:w-5"
          aria-label="Open image"
          title="Open image"
        >
          <FolderOpen className="h-5 w-5" />
        </Button>
        {image ? (
          <>
            <Button
              type="button"
              onClick={onFitView}
              className="h-10 w-10 px-0 [&_svg]:h-5 [&_svg]:w-5"
              aria-label="Fit image to view"
              title="Fit image to view"
            >
              <Maximize2 className="h-5 w-5" />
            </Button>
            <input
              type="range"
              min={minZoom}
              max={maxZoom}
              step="0.25"
              value={zoom}
              onChange={(event) => onZoomChange(Number(event.target.value))}
              className="h-32 w-9 cursor-pointer accent-violet-400 [writing-mode:vertical-lr]"
              style={{ direction: 'rtl' }}
              aria-label="Zoom"
            />
          </>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          onImportFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </section>
  )
}
