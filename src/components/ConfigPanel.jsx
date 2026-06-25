import {
  Download,
  FileArchive,
  ImagePlus,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react'
import { APP_CONFIG, GLASS_RGBA } from '../config/appConfig'
import { Button, CheckboxField, Field, Section, SelectInput, TextInput } from './FormControls'

function formatGlassColorName(name) {
  const label = name.replaceAll('_', ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function ConfigPanel({
  settings,
  validation,
  runtimeError,
  generation,
  download,
  stats,
  isRunning,
  canGenerate,
  onSettingChange,
  onDimensionChange,
  onToggleGlassColor,
  onGenerate,
  onStopRequest,
}) {
  return (
    <aside className="relative z-30 flex h-full min-h-0 min-w-0 flex-col bg-zinc-950">
      <div className="shrink-0 border-b border-zinc-800 px-5 py-4">
        <div className="flex items-center gap-2 text-lg font-medium">
          <FileArchive className="h-5 w-5 text-violet-300" />
          Glass image builder
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Image generator with stained glass in Minecraft
        </p>
      </div>

      <div className="scrollbar-hidden min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <fieldset disabled={isRunning} className={`m-0 min-w-0 border-0 p-0 ${isRunning ? 'opacity-60' : ''}`}>
          <Section title="Schematic Configuration" icon={FileArchive}>
            <Field label="File name">
              <TextInput
                value={settings.schematicFileName}
                onChange={(event) => onSettingChange('schematicFileName', event.target.value)}
              />
            </Field>
          </Section>

          <Section title="Image Configuration" icon={ImagePlus}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Width">
                <TextInput
                  type="number"
                  min="1"
                  value={settings.resultWidth}
                  onChange={(event) => onDimensionChange('resultWidth', event.target.value)}
                />
              </Field>
              <Field label="Height">
                <TextInput
                  type="number"
                  min="1"
                  value={settings.resultHeight}
                  onChange={(event) => onDimensionChange('resultHeight', event.target.value)}
                />
              </Field>
            </div>
            {Number(settings.resultHeight) > APP_CONFIG.minecraft.maxY ? (
              <p className="text-xs leading-5 text-red-300">
                Minecraft build limit is 320 blocks, so think about the height again.
              </p>
            ) : null}
            <CheckboxField
              label="Keep aspect ratio"
              checked={settings.lockAspectRatio}
              onChange={(checked) => onSettingChange('lockAspectRatio', checked)}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Resize filter">
                <SelectInput
                  value={settings.resizeFilter}
                  onChange={(event) => onSettingChange('resizeFilter', event.target.value)}
                >
                  {APP_CONFIG.resizeFilters.map((filter) => (
                    <option key={filter} value={filter}>
                      {filter}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Mask filter">
                <SelectInput
                  value={settings.buildMaskResizeFilter}
                  onChange={(event) => onSettingChange('buildMaskResizeFilter', event.target.value)}
                >
                  {APP_CONFIG.resizeFilters.map((filter) => (
                    <option key={filter} value={filter}>
                      {filter}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            </div>
            <CheckboxField
              label="Reverse"
              checked={settings.mirrorImageWidthAxis}
              onChange={(checked) => onSettingChange('mirrorImageWidthAxis', checked)}
              help={APP_CONFIG.help.mirrorImageWidthAxis}
            />
          </Section>

          <Section title="Solver Configuration" icon={SlidersHorizontal}>
            <CheckboxField
              label="Use fast solving"
              checked={settings.useFastSolving}
              onChange={(checked) => onSettingChange('useFastSolving', checked)}
              help={APP_CONFIG.help.useFastSolving}
            />

            {settings.useFastSolving ? (
              <Field label="Space between layers" help={APP_CONFIG.help.layerStepBlocks}>
                <TextInput
                  type="number"
                  min="0"
                  value={settings.layerStepBlocks}
                  onChange={(event) => onSettingChange('layerStepBlocks', event.target.value)}
                />
              </Field>
            ) : null}

            {!settings.useFastSolving ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Max layers" help={APP_CONFIG.help.maxLayers}>
                    <TextInput
                      type="number"
                      min="1"
                      value={settings.maxLayers}
                      onChange={(event) => onSettingChange('maxLayers', event.target.value)}
                    />
                  </Field>
                  <Field label="Space between layers" help={APP_CONFIG.help.layerStepBlocks}>
                    <TextInput
                      type="number"
                      min="0"
                      value={settings.layerStepBlocks}
                      onChange={(event) => onSettingChange('layerStepBlocks', event.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid gap-2">
                  <span className="text-sm text-zinc-300">Colors</span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Object.entries(GLASS_RGBA).map(([name, rgba]) => (
                      <label
                        key={name}
                        className="flex min-w-0 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2 text-xs text-zinc-300"
                      >
                        <input
                          type="checkbox"
                          checked={settings.glassColorNames.includes(name)}
                          onChange={(event) => onToggleGlassColor(name, event.target.checked)}
                          className="h-3.5 w-3.5 shrink-0 accent-violet-400"
                        />
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm border border-black/30"
                          style={{ backgroundColor: `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})` }}
                        />
                        <span className="truncate">{formatGlassColorName(name)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </Section>
        </fieldset>

        {stats ? (
          <section className="border-b border-zinc-800 px-5 py-5 text-sm text-zinc-300">
            <h2 className="mb-3 font-medium text-zinc-100">Last generation</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <span>Unique colors: {stats.uniqueColors}</span>
              <span>Palette stacks: {stats.paletteSize}</span>
              <span>Dimensions: {stats.dimensions}</span>
              <span>Placed blocks: {stats.placedBlockCount}</span>
              <span>Mean layers: {stats.meanLayers.toFixed(2)}</span>
              <span>Mean error: {stats.meanRgbDistance.toFixed(2)}</span>
            </div>
          </section>
        ) : null}
      </div>

      <div className="sticky bottom-0 z-40 shrink-0 border-t border-zinc-800 bg-zinc-950/95 p-5 backdrop-blur">
        {validation.length || runtimeError ? (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100">
            {runtimeError || validation[0]}
          </div>
        ) : null}
        {isRunning ? (
          <div className="grid gap-3">
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-violet-400 transition-all"
                style={{ width: `${generation.progress}%` }}
              />
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 truncate text-sm text-zinc-300">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-300" />
                <span className="truncate">{generation.label}</span>
              </span>
              <Button type="button" variant="danger" onClick={onStopRequest}>
                <PauseCircle className="h-4 w-4" />
                Stop
              </Button>
            </div>
          </div>
        ) : download ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <a
              href={download.url}
              download={download.fileName}
              className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-md bg-violet-400 px-4 text-sm font-medium text-zinc-950 transition hover:bg-violet-300"
            >
              <Download className="h-4 w-4 shrink-0" />
              <span className="truncate">Download {download.fileName}</span>
            </a>
            <button
              type="button"
              disabled={!canGenerate}
              onClick={onGenerate}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-100 transition hover:border-violet-400 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500"
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!canGenerate}
            onClick={onGenerate}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-violet-400 px-4 text-sm font-medium text-zinc-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            <Play className="h-4 w-4" />
            Generate schematic
          </button>
        )}
      </div>
    </aside>
  )
}
