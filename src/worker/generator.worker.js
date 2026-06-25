import { gzip } from 'pako'
import { APP_CONFIG, GLASS_RGBA } from '../config/appConfig'

let cancelled = false
const colorCache = new Map()
const lutCache = new Map()

const GLASS_LUT_COLOR_NAMES = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
]

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0))
const clampByte = (value) => clamp(Math.round(Number(value) || 0), 0, 255)

function normalizeGlassName(name) {
  return String(name)
    .replace(/^minecraft:/, '')
    .replace(/\.png$/, '')
    .split('/')
    .at(-1)
    .replace(/_stained_glass$/, '')
}

function glassBlockState(name) {
  return `minecraft:${normalizeGlassName(name)}_stained_glass`
}

function blendColorBehindGlass(baseRgb, glassRgba) {
  const [br, bg, bb] = baseRgb
  const [gr, gg, gb, alpha] = glassRgba
  return [
    br * (1 - alpha) + gr * alpha,
    bg * (1 - alpha) + gg * alpha,
    bb * (1 - alpha) + gb * alpha,
  ]
}

function rgbDistanceSq(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

function rgbDistance(a, b) {
  return Math.sqrt(rgbDistanceSq(a, b))
}

function renderLutStackRgb(stackIndexes) {
  const alpha = GLASS_RGBA.white[3]
  let r = 255
  let g = 255
  let b = 255

  for (const glassIndex of stackIndexes) {
    const glass = GLASS_RGBA[GLASS_LUT_COLOR_NAMES[glassIndex]]
    r = r * (1 - alpha) + glass[0] * alpha
    g = g * (1 - alpha) + glass[1] * alpha
    b = b * (1 - alpha) + glass[2] * alpha
  }

  return [Math.round(r), Math.round(g), Math.round(b)]
}

async function loadGlassLutQ32(url = `${import.meta.env.BASE_URL}lut_q32.glut`) {
  const cached = lutCache.get(url)
  if (cached) return cached

  const promise = fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load LUT: ${response.status} ${response.statusText}`)
      }

      const bytes = new Uint8Array(await response.arrayBuffer())

      if (bytes.length < 8) {
        throw new Error('Invalid GLUT file: too small')
      }

      const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
      if (magic !== 'GLUT') {
        throw new Error(`Invalid GLUT magic: ${magic}`)
      }

      const version = bytes[4]
      const gridSize = bytes[5]
      const layers = bytes[6]

      if (version !== 1) throw new Error(`Unsupported GLUT version: ${version}`)
      if (gridSize !== 32) throw new Error(`Expected q32 LUT, got q${gridSize}`)
      if (layers !== 6) throw new Error(`Expected 6 glass layers, got ${layers}`)

      const headerSize = 8
      const expectedSize = headerSize + gridSize * gridSize * gridSize * 3
      if (bytes.length !== expectedSize) {
        throw new Error(`Invalid GLUT size: got ${bytes.length}, expected ${expectedSize}`)
      }

      function readStackAtIndex(qIndex) {
        const offset = headerSize + qIndex * 3
        const b0 = bytes[offset]
        const b1 = bytes[offset + 1]
        const b2 = bytes[offset + 2]
        return [b0 >> 4, b0 & 15, b1 >> 4, b1 & 15, b2 >> 4, b2 & 15]
      }

      function readStackAtGrid(rq, gq, bq) {
        return readStackAtIndex((rq * gridSize + gq) * gridSize + bq)
      }

      function getStackIndexes(r, g, b) {
        return readStackAtGrid(clampByte(r) >> 3, clampByte(g) >> 3, clampByte(b) >> 3)
      }

      function getBestStackIndexes(r, g, b) {
        const target = [clampByte(r), clampByte(g), clampByte(b)]
        const rf = target[0] / 8
        const gf = target[1] / 8
        const bf = target[2] / 8

        const r0 = clamp(Math.floor(rf), 0, 31)
        const g0 = clamp(Math.floor(gf), 0, 31)
        const b0 = clamp(Math.floor(bf), 0, 31)
        const r1 = clamp(r0 + 1, 0, 31)
        const g1 = clamp(g0 + 1, 0, 31)
        const b1 = clamp(b0 + 1, 0, 31)

        let bestStack = null
        let bestDistance = Number.POSITIVE_INFINITY
        const seen = new Set()
        const candidates = [
          [r0, g0, b0],
          [r1, g0, b0],
          [r0, g1, b0],
          [r0, g0, b1],
          [r1, g1, b0],
          [r1, g0, b1],
          [r0, g1, b1],
          [r1, g1, b1],
        ]

        for (const [rq, gq, bq] of candidates) {
          const key = `${rq},${gq},${bq}`
          if (seen.has(key)) continue
          seen.add(key)

          const stack = readStackAtGrid(rq, gq, bq)
          const distance = rgbDistanceSq(target, renderLutStackRgb(stack))
          if (distance < bestDistance) {
            bestDistance = distance
            bestStack = stack
          }
        }

        return bestStack
      }

      return {
        gridSize,
        layers,
        readStackAtIndex,
        getStackIndexes,
        getBestStackIndexes,
        renderStackRgb: renderLutStackRgb,
      }
    })
    .catch((error) => {
      lutCache.delete(url)
      throw error
    })

  lutCache.set(url, promise)
  return promise
}

function quantizedColorKey(color, binSize) {
  return color.map((channel) => Math.floor(clamp(Math.round(channel), 0, 255) / binSize)).join(':')
}

function trimSolverBeam(states, beamWidth, binSize) {
  states.sort((a, b) => {
    if (a.distanceSq !== b.distanceSq) return a.distanceSq - b.distanceSq
    if (a.stack.length !== b.stack.length) return a.stack.length - b.stack.length
    return a.stack.join(',').localeCompare(b.stack.join(','))
  })

  if (states.length <= beamWidth) return states

  const kept = []
  const seenBins = new Set()

  for (const state of states) {
    const key = quantizedColorKey(state.color, binSize)
    if (seenBins.has(key)) continue
    seenBins.add(key)
    kept.push(state)
    if (kept.length >= beamWidth) return kept
  }

  const seenStacks = new Set(kept.map((state) => state.stack.join('|')))
  for (const state of states) {
    const key = state.stack.join('|')
    if (seenStacks.has(key)) continue
    kept.push(state)
    if (kept.length >= beamWidth) break
  }

  return kept
}

function solverCacheKey(targetRgb, settings) {
  return JSON.stringify({
    targetRgb,
    glassColorNames: settings.glassColorNames,
    baseBlockRgb: settings.baseBlockRgb,
    minLayers: settings.minLayers,
    maxLayers: settings.maxLayers,
    perColorBeamWidth: settings.perColorBeamWidth,
    solverColorBinSize: settings.solverColorBinSize,
    newLayerMinImprovement: settings.newLayerMinImprovement,
    newLayerMinColorDelta: settings.newLayerMinColorDelta,
    perfectMatchDistance: settings.perfectMatchDistance,
  })
}

function solveTargetColor(targetRgb, glassOptions, settings) {
  const cacheKey = solverCacheKey(targetRgb, settings)
  const cached = colorCache.get(cacheKey)
  if (cached) return cached

  const target = targetRgb.map(Number)
  const baseColor = settings.baseBlockRgb.map(Number)
  const baseState = {
    color: baseColor,
    stack: [],
    distanceSq: rgbDistanceSq(baseColor, target),
  }

  let bestAllowed = settings.minLayers === 0 ? baseState : null
  let currentBeam = [baseState]

  if (bestAllowed && Math.sqrt(bestAllowed.distanceSq) <= settings.perfectMatchDistance) {
    colorCache.set(cacheKey, bestAllowed)
    return bestAllowed
  }

  for (let depth = 1; depth <= settings.maxLayers; depth += 1) {
    const expanded = []

    for (const state of currentBeam) {
      for (const [colorName, glassRgba] of glassOptions) {
        const color = blendColorBehindGlass(state.color, glassRgba)
        expanded.push({
          color,
          stack: [...state.stack, colorName],
          distanceSq: rgbDistanceSq(color, target),
        })
      }
    }

    currentBeam = trimSolverBeam(expanded, settings.perColorBeamWidth, settings.solverColorBinSize)
    if (!currentBeam.length) break

    const depthBest = currentBeam[0]
    const depthBestDistance = Math.sqrt(depthBest.distanceSq)

    if (depthBestDistance <= settings.perfectMatchDistance && depth >= settings.minLayers) {
      colorCache.set(cacheKey, depthBest)
      return depthBest
    }

    if (depth < settings.minLayers) continue

    if (!bestAllowed) {
      bestAllowed = depthBest
      continue
    }

    const previousDistance = Math.sqrt(bestAllowed.distanceSq)
    const improvement = previousDistance - depthBestDistance
    const colorDelta = rgbDistance(bestAllowed.color, depthBest.color)

    if (depthBest.distanceSq < bestAllowed.distanceSq) bestAllowed = depthBest

    if (
      improvement <= settings.newLayerMinImprovement &&
      colorDelta <= settings.newLayerMinColorDelta
    ) {
      break
    }
  }

  if (!bestAllowed) throw new Error('No valid glass stack found for one of the target colors.')
  colorCache.set(cacheKey, bestAllowed)
  return bestAllowed
}

function smoothingQuality(filter) {
  if (filter === 'NEAREST') return { enabled: false, quality: 'low' }
  if (filter === 'BOX' || filter === 'BILINEAR') return { enabled: true, quality: 'low' }
  if (filter === 'HAMMING' || filter === 'BICUBIC') return { enabled: true, quality: 'medium' }
  return { enabled: true, quality: 'high' }
}

function drawImageToCanvas(imageBitmap, width, height, filter) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const smoothing = smoothingQuality(filter)
  context.imageSmoothingEnabled = smoothing.enabled
  context.imageSmoothingQuality = smoothing.quality
  context.drawImage(imageBitmap, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

function makeBuildMask(imageBitmap, targetWidth, targetHeight, settings) {
  const sourceCanvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  sourceContext.drawImage(imageBitmap, 0, 0)
  const sourceData = sourceContext.getImageData(0, 0, imageBitmap.width, imageBitmap.height)
  const sourcePixels = sourceData.data

  if (!settings.skipTransparentPixels) {
    return new Uint8Array(targetWidth * targetHeight).fill(1)
  }

  if (!settings.cleanTransparentResizeEdges) {
    const resized = drawImageToCanvas(imageBitmap, targetWidth, targetHeight, settings.resizeFilter)
    const mask = new Uint8Array(targetWidth * targetHeight)
    for (let index = 0; index < mask.length; index += 1) {
      mask[index] = resized.data[index * 4 + 3] > settings.transparentAlphaThreshold ? 1 : 0
    }
    return mask
  }

  const hardAlpha = sourceContext.createImageData(imageBitmap.width, imageBitmap.height)
  for (let index = 0; index < imageBitmap.width * imageBitmap.height; index += 1) {
    const alpha = sourcePixels[index * 4 + 3]
    const value = alpha > settings.transparentAlphaThreshold ? 255 : 0
    hardAlpha.data[index * 4] = value
    hardAlpha.data[index * 4 + 1] = value
    hardAlpha.data[index * 4 + 2] = value
    hardAlpha.data[index * 4 + 3] = 255
  }
  sourceContext.putImageData(hardAlpha, 0, 0)

  const targetCanvas = new OffscreenCanvas(targetWidth, targetHeight)
  const targetContext = targetCanvas.getContext('2d', { willReadFrequently: true })
  const smoothing = smoothingQuality(settings.buildMaskResizeFilter)
  targetContext.imageSmoothingEnabled = smoothing.enabled
  targetContext.imageSmoothingQuality = smoothing.quality
  targetContext.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight)
  const resizedMask = targetContext.getImageData(0, 0, targetWidth, targetHeight).data
  const mask = new Uint8Array(targetWidth * targetHeight)

  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = resizedMask[index * 4] >= settings.buildMaskCoverageThreshold ? 1 : 0
  }

  return mask
}

function prepareTargetImage(imageBitmap, settings) {
  const width = Number(settings.resultWidth)
  const height =
    Number(settings.resultHeight) > 0
      ? Number(settings.resultHeight)
      : Math.max(1, Math.round(imageBitmap.height * (width / imageBitmap.width)))

  const imageData = drawImageToCanvas(imageBitmap, width, height, settings.resizeFilter)
  const mask = makeBuildMask(imageBitmap, width, height, settings)
  const rgb = new Uint8Array(width * height * 3)
  const alphaBackground = settings.alphaBackgroundRgb.map(Number)

  for (let index = 0; index < width * height; index += 1) {
    const sourceIndex = index * 4
    const alpha = imageData.data[sourceIndex + 3] / 255
    const targetIndex = index * 3
    rgb[targetIndex] = Math.round(imageData.data[sourceIndex] * alpha + alphaBackground[0] * (1 - alpha))
    rgb[targetIndex + 1] = Math.round(
      imageData.data[sourceIndex + 1] * alpha + alphaBackground[1] * (1 - alpha),
    )
    rgb[targetIndex + 2] = Math.round(
      imageData.data[sourceIndex + 2] * alpha + alphaBackground[2] * (1 - alpha),
    )
  }

  if (settings.imageMaxColors > 0) {
    const levels = clamp(Math.round(Math.cbrt(settings.imageMaxColors)), 2, 6)
    const step = 255 / (levels - 1)
    for (let index = 0; index < rgb.length; index += 1) {
      rgb[index] = Math.round(Math.round(rgb[index] / step) * step)
    }
  }

  if (settings.mirrorImageWidthAxis) {
    const mirroredRgb = new Uint8Array(rgb.length)
    const mirroredMask = new Uint8Array(mask.length)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceX = width - 1 - x
        const sourcePixel = y * width + sourceX
        const targetPixel = y * width + x
        mirroredMask[targetPixel] = mask[sourcePixel]
        mirroredRgb[targetPixel * 3] = rgb[sourcePixel * 3]
        mirroredRgb[targetPixel * 3 + 1] = rgb[sourcePixel * 3 + 1]
        mirroredRgb[targetPixel * 3 + 2] = rgb[sourcePixel * 3 + 2]
      }
    }

    return { width, height, rgb: mirroredRgb, mask: mirroredMask }
  }

  return { width, height, rgb, mask }
}

function buildColorGroups(target) {
  const groups = new Map()
  let buildablePixels = 0

  for (let index = 0; index < target.width * target.height; index += 1) {
    if (!target.mask[index]) continue
    buildablePixels += 1
    const rgbIndex = index * 3
    const key = `${target.rgb[rgbIndex]},${target.rgb[rgbIndex + 1]},${target.rgb[rgbIndex + 2]}`
    let group = groups.get(key)
    if (!group) {
      group = {
        rgb: [target.rgb[rgbIndex], target.rgb[rgbIndex + 1], target.rgb[rgbIndex + 2]],
        indexes: [],
      }
      groups.set(key, group)
    }
    group.indexes.push(index)
  }

  return { groups: [...groups.values()], buildablePixels }
}

function q32IndexFromRgb(target, pixelIndex) {
  const rgbIndex = pixelIndex * 3
  return ((target.rgb[rgbIndex] >> 3) * 32 + (target.rgb[rgbIndex + 1] >> 3)) * 32 + (target.rgb[rgbIndex + 2] >> 3)
}

function rgbFromQ32Index(q32Index) {
  const rq = q32Index >> 10
  const gq = (q32Index >> 5) & 31
  const bq = q32Index & 31
  return [
    Math.min(255, rq * 8 + 4),
    Math.min(255, gq * 8 + 4),
    Math.min(255, bq * 8 + 4),
  ]
}

function summarizeFastLutTarget(target) {
  const seenQ32 = new Uint8Array(32 * 32 * 32)
  let buildablePixels = 0
  let uniqueColors = 0

  for (let index = 0; index < target.width * target.height; index += 1) {
    if (!target.mask[index]) continue
    buildablePixels += 1

    const q32Index = q32IndexFromRgb(target, index)
    if (!seenQ32[q32Index]) {
      seenQ32[q32Index] = 1
      uniqueColors += 1
    }
  }

  return { buildablePixels, uniqueColors }
}

function buildPalette(states) {
  const stackToIndex = new Map()
  const stacks = []
  const colors = []
  const lengths = []
  const indexes = []

  for (const state of states) {
    const key = state.stack.join('|')
    let index = stackToIndex.get(key)
    if (index === undefined) {
      index = stacks.length
      stackToIndex.set(key, index)
      stacks.push(state.stack)
      colors.push(state.color)
      lengths.push(state.stack.length)
    }
    indexes.push(index)
  }

  return { stacks, colors, lengths, indexes }
}

async function buildFastLutSolution(target, lut, summary) {
  const q32ToPaletteIndex = new Int32Array(32 * 32 * 32).fill(-1)
  const stackToIndex = new Map()
  const stacks = []
  const colors = []
  const lengths = []
  const paletteIndexesByPixel = new Int32Array(target.width * target.height).fill(-1)
  const batchIndexes = []
  const batchColors = []
  const overlayBatchSize = 8192
  const yieldBatchSize = 16384

  let solvedPixels = 0
  let errorSum = 0
  let maxRgbDistance = 0
  let layerSum = 0
  let minUsedLayers = Number.POSITIVE_INFINITY
  let maxUsedLayers = 0

  function paletteIndexForQ32(q32Index) {
    const existingPaletteIndex = q32ToPaletteIndex[q32Index]
    if (existingPaletteIndex >= 0) return existingPaletteIndex

    const [r, g, b] = rgbFromQ32Index(q32Index)
    const stackIndexes = lut.getBestStackIndexes(r, g, b)
    const key = stackIndexes.join('|')
    let paletteIndex = stackToIndex.get(key)

    if (paletteIndex === undefined) {
      paletteIndex = stacks.length
      stackToIndex.set(key, paletteIndex)
      stacks.push(stackIndexes.map((index) => GLASS_LUT_COLOR_NAMES[index]))
      colors.push(lut.renderStackRgb(stackIndexes))
      lengths.push(stackIndexes.length)
    }

    q32ToPaletteIndex[q32Index] = paletteIndex
    return paletteIndex
  }

  async function flushOverlay(force = false) {
    if (!batchIndexes.length || (!force && batchIndexes.length < overlayBatchSize)) return

    self.postMessage({
      type: 'overlay',
      solvedColors: solvedPixels,
      uniqueColors: summary.buildablePixels,
      label: `Mapped ${solvedPixels} of ${summary.buildablePixels} pixels`,
      indexes: new Uint32Array(batchIndexes),
      colors: new Uint8ClampedArray(batchColors),
    })
    batchIndexes.length = 0
    batchColors.length = 0
    await sleep()
  }

  for (let pixelIndex = 0; pixelIndex < target.width * target.height; pixelIndex += 1) {
    if (!target.mask[pixelIndex]) continue

    const paletteIndex = paletteIndexForQ32(q32IndexFromRgb(target, pixelIndex))
    const renderedColor = colors[paletteIndex]
    const stackLength = lengths[paletteIndex]
    const rgbIndex = pixelIndex * 3
    const dr = target.rgb[rgbIndex] - renderedColor[0]
    const dg = target.rgb[rgbIndex + 1] - renderedColor[1]
    const db = target.rgb[rgbIndex + 2] - renderedColor[2]
    const distance = Math.sqrt(dr * dr + dg * dg + db * db)

    paletteIndexesByPixel[pixelIndex] = paletteIndex
    solvedPixels += 1
    errorSum += distance
    maxRgbDistance = Math.max(maxRgbDistance, distance)
    layerSum += stackLength
    minUsedLayers = Math.min(minUsedLayers, stackLength)
    maxUsedLayers = Math.max(maxUsedLayers, stackLength)
    batchIndexes.push(pixelIndex)
    batchColors.push(renderedColor[0], renderedColor[1], renderedColor[2])

    if (batchIndexes.length >= overlayBatchSize) {
      await flushOverlay()
    } else if (solvedPixels % yieldBatchSize === 0) {
      await sleep()
    }

    if (cancelled) {
      self.postMessage({ type: 'cancelled' })
      return null
    }
  }

  await flushOverlay(true)

  return {
    paletteIndexesByPixel,
    palette: { stacks, colors, lengths, indexes: [] },
    stats: {
      width: target.width,
      height: target.height,
      totalPixels: target.width * target.height,
      buildablePixels: summary.buildablePixels,
      skippedPixels: target.width * target.height - summary.buildablePixels,
      uniqueColors: summary.uniqueColors,
      paletteSize: stacks.length,
      meanRgbDistance: errorSum / solvedPixels,
      maxRgbDistance,
      meanLayers: layerSum / solvedPixels,
      minUsedLayers,
      maxUsedLayers,
    },
  }
}

function imageYToSchematicY(py, height, settings) {
  if (settings.imageTopToHighY) return height - 1 - py
  return py
}

function schematicDepthSize(settings) {
  const maxLayers = Math.max(0, Number(settings.maxLayers))
  const step = Math.max(1, Number(settings.layerStepBlocks))
  const layerSpan = maxLayers > 0 ? (maxLayers - 1) * step + 1 : 0
  return Math.max(1, layerSpan + (settings.placeBaseBlocks ? 1 : 0))
}

function schematicDepthForLayer(layer, depthSize, settings) {
  const step = Math.max(1, Number(settings.layerStepBlocks))
  const firstLayerDepth =
    Number(settings.layerDirection) === -1
      ? depthSize - 1 - (settings.placeBaseBlocks ? 1 : 0)
      : settings.placeBaseBlocks
        ? 1
        : 0
  return firstLayerDepth + (Number(settings.layerDirection) === -1 ? -layer * step : layer * step)
}

function schematicBaseDepth(depthSize, settings) {
  return Number(settings.layerDirection) === -1 ? depthSize - 1 : 0
}

function normalizeBlockStateName(blockState) {
  const value = String(blockState || 'minecraft:air').trim()
  return value.includes(':') ? value : `minecraft:${value}`
}

function sanitizeFileBase(value, fallback) {
  const segment = String(value || fallback)
    .trim()
    .replace(/\.schem$/i, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/[.\s]+$/g, '')
  return segment || fallback
}

function schematicFileName(settings) {
  return `${sanitizeFileBase(settings.schematicFileName, APP_CONFIG.defaults.schematicFileName)}.schem`
}

function writeVarints(values) {
  const bytes = []

  for (let value of values) {
    value = Number(value)
    while ((value & -128) !== 0) {
      bytes.push((value & 127) | 128)
      value >>>= 7
    }
    bytes.push(value)
  }

  return bytes
}

class NbtWriter {
  constructor() {
    this.bytes = []
    this.encoder = new TextEncoder()
  }

  writeByte(value) {
    this.bytes.push(value & 255)
  }

  writeShort(value) {
    this.bytes.push((value >> 8) & 255, value & 255)
  }

  writeInt(value) {
    this.bytes.push((value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255)
  }

  writeStringValue(value) {
    const encoded = this.encoder.encode(String(value))
    this.writeShort(encoded.length)
    this.bytes.push(...encoded)
  }

  writeHeader(type, name) {
    this.writeByte(type)
    this.writeStringValue(name)
  }

  writeIntTag(name, value) {
    this.writeHeader(3, name)
    this.writeInt(value)
  }

  writeShortTag(name, value) {
    this.writeHeader(2, name)
    this.writeShort(value)
  }

  writeByteArrayTag(name, value) {
    this.writeHeader(7, name)
    this.writeInt(value.length)
    for (const byte of value) {
      this.bytes.push(byte & 255)
    }
  }

  writeCompoundTag(name, writeBody) {
    this.writeHeader(10, name)
    writeBody()
    this.writeByte(0)
  }

  finishRoot(writeBody) {
    this.writeHeader(10, 'Schematic')
    writeBody()
    this.writeByte(0)
    return new Uint8Array(this.bytes)
  }
}

function buildSchematicData(target, paletteIndexesByPixel, palette, settings) {
  const depthSize = schematicDepthSize(settings)
  const width = settings.layerAxis === 'z' ? target.width : depthSize
  const height = target.height
  const length = settings.layerAxis === 'z' ? depthSize : target.width
  const blockIndexes = new Uint32Array(width * height * length)
  const blockPalette = ['minecraft:air']
  const blockStateToIndex = new Map(blockPalette.map((state, index) => [state, index]))
  let placedBlockCount = 0

  function paletteIndexFor(blockState) {
    const normalized = normalizeBlockStateName(blockState)
    const existing = blockStateToIndex.get(normalized)
    if (existing !== undefined) return existing
    const nextIndex = blockPalette.length
    blockStateToIndex.set(normalized, nextIndex)
    blockPalette.push(normalized)
    return nextIndex
  }

  function setBlockIndex(x, y, z, blockIndex) {
    const index = (y * length + z) * width + x
    if (blockIndexes[index] === 0) placedBlockCount += 1
    blockIndexes[index] = blockIndex
  }

  function setPixelDepthIndex(px, py, depth, blockIndex) {
    const y = imageYToSchematicY(py, target.height, settings)
    if (settings.layerAxis === 'z') {
      setBlockIndex(px, y, depth, blockIndex)
      return
    }
    setBlockIndex(depth, y, px, blockIndex)
  }

  if (settings.placeBaseBlocks) {
    const baseDepth = schematicBaseDepth(depthSize, settings)
    const baseBlockIndex = paletteIndexFor(settings.baseBlockState)
    for (let py = 0; py < target.height; py += 1) {
      for (let px = 0; px < target.width; px += 1) {
        if (target.mask[py * target.width + px]) {
          setPixelDepthIndex(px, py, baseDepth, baseBlockIndex)
        }
      }
    }
  }

  const stackBlockIndexes = palette.stacks.map((stack) =>
    stack.map((blockName) => paletteIndexFor(glassBlockState(blockName))),
  )

  for (let py = 0; py < target.height; py += 1) {
    for (let px = 0; px < target.width; px += 1) {
      const pixelIndex = py * target.width + px
      if (!target.mask[pixelIndex]) continue

      const paletteIndex = paletteIndexesByPixel[pixelIndex]
      const stack = stackBlockIndexes[paletteIndex]
      for (let layer = 0; layer < stack.length; layer += 1) {
        setPixelDepthIndex(px, py, schematicDepthForLayer(layer, depthSize, settings), stack[layer])
      }
    }
  }

  return {
    width,
    height,
    length,
    blockPalette,
    blockData: writeVarints(blockIndexes),
    placedBlockCount,
  }
}

function writeSchematicNbt(schematic) {
  const writer = new NbtWriter()
  return writer.finishRoot(() => {
    writer.writeIntTag('PaletteMax', schematic.blockPalette.length)
    writer.writeCompoundTag('Palette', () => {
      schematic.blockPalette.forEach((blockState, index) => writer.writeIntTag(blockState, index))
    })
    writer.writeIntTag('Version', 2)
    writer.writeShortTag('Length', schematic.length)
    writer.writeCompoundTag('Metadata', () => {
      writer.writeIntTag('WEOffsetX', 0)
      writer.writeIntTag('WEOffsetY', 0)
      writer.writeIntTag('WEOffsetZ', 0)
    })
    writer.writeShortTag('Height', schematic.height)
    writer.writeIntTag('DataVersion', APP_CONFIG.minecraft.defaultDataVersion)
    writer.writeByteArrayTag('BlockData', schematic.blockData)
    writer.writeShortTag('Width', schematic.width)
  })
}

function buildSchematicBlob(target, paletteIndexesByPixel, palette, settings) {
  const schematic = buildSchematicData(target, paletteIndexesByPixel, palette, settings)
  const compressed = gzip(writeSchematicNbt(schematic), { level: settings.useFastSolving ? 1 : 9 })
  return {
    blob: new Blob([compressed], { type: 'application/octet-stream' }),
    metadata: schematic,
  }
}

async function generate({ fileBuffer, fileType, settings }) {
  cancelled = false
  const blob = new Blob([fileBuffer], { type: fileType })
  const imageBitmap = await createImageBitmap(blob)
  const target = prepareTargetImage(imageBitmap, settings)

  if (settings.useFastSolving) {
    const summary = summarizeFastLutTarget(target)

    if (!summary.buildablePixels) throw new Error('No buildable pixels found. Check transparency settings.')

    self.postMessage({
      type: 'prepared',
      width: target.width,
      height: target.height,
      buildablePixels: summary.buildablePixels,
      skippedPixels: target.width * target.height - summary.buildablePixels,
      uniqueColors: summary.uniqueColors,
    })

    const lut = await loadGlassLutQ32()
    const solution = await buildFastLutSolution(target, lut, summary)
    if (!solution) return

    const schematic = buildSchematicBlob(target, solution.paletteIndexesByPixel, solution.palette, settings)

    self.postMessage({
      type: 'done',
      schematicBlob: schematic.blob,
      fileName: schematicFileName(settings),
      stats: {
        ...solution.stats,
        dimensions: `${schematic.metadata.width} x ${schematic.metadata.height} x ${schematic.metadata.length}`,
        schematicVolume: schematic.metadata.width * schematic.metadata.height * schematic.metadata.length,
        placedBlockCount: schematic.metadata.placedBlockCount,
      },
    })
    return
  }

  const { groups, buildablePixels } = buildColorGroups(target)

  if (!buildablePixels) throw new Error('No buildable pixels found. Check transparency settings.')

  self.postMessage({
    type: 'prepared',
    width: target.width,
    height: target.height,
    buildablePixels,
    skippedPixels: target.width * target.height - buildablePixels,
    uniqueColors: groups.length,
  })

  const glassOptions = settings.glassColorNames.map((colorName) => {
    const key = normalizeGlassName(colorName)
    return [key, GLASS_RGBA[key]]
  })
  const paletteIndexesByPixel = new Int32Array(target.width * target.height).fill(-1)
  const solvedStates = []
  const batchIndexes = []
  const batchColors = []

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    if (cancelled) {
      self.postMessage({ type: 'cancelled' })
      return
    }

    const group = groups[groupIndex]
    const state = solveTargetColor(group.rgb, glassOptions, settings)
    solvedStates.push(state)
    const renderedColor = state.color.map((channel) => clamp(Math.round(channel), 0, 255))

    for (const pixelIndex of group.indexes) {
      batchIndexes.push(pixelIndex)
      batchColors.push(renderedColor[0], renderedColor[1], renderedColor[2])
    }

    if ((groupIndex + 1) % 12 === 0 || groupIndex + 1 === groups.length) {
      self.postMessage({
        type: 'overlay',
        solvedColors: groupIndex + 1,
        uniqueColors: groups.length,
        indexes: new Uint32Array(batchIndexes),
        colors: new Uint8ClampedArray(batchColors),
      })
      batchIndexes.length = 0
      batchColors.length = 0
      await sleep()
    }
  }

  const palette = buildPalette(solvedStates)

  groups.forEach((group, groupIndex) => {
    const paletteIndex = palette.indexes[groupIndex]
    for (const pixelIndex of group.indexes) {
      paletteIndexesByPixel[pixelIndex] = paletteIndex
    }
  })

  const usedLengths = []
  for (let index = 0; index < paletteIndexesByPixel.length; index += 1) {
    const paletteIndex = paletteIndexesByPixel[index]
    if (paletteIndex >= 0) usedLengths.push(palette.lengths[paletteIndex])
  }

  const errorSummary = solvedStates.reduce(
    (summary, state) => {
      const error = Math.sqrt(state.distanceSq)
      return {
        sum: summary.sum + error,
        max: Math.max(summary.max, error),
      }
    },
    { sum: 0, max: 0 },
  )
  const lengthSummary = usedLengths.reduce(
    (summary, value) => ({
      sum: summary.sum + value,
      min: Math.min(summary.min, value),
      max: Math.max(summary.max, value),
    }),
    { sum: 0, min: Number.POSITIVE_INFINITY, max: 0 },
  )
  const stats = {
    width: target.width,
    height: target.height,
    totalPixels: target.width * target.height,
    buildablePixels,
    skippedPixels: target.width * target.height - buildablePixels,
    uniqueColors: groups.length,
    paletteSize: palette.stacks.length,
    meanRgbDistance: errorSummary.sum / solvedStates.length,
    maxRgbDistance: errorSummary.max,
    meanLayers: lengthSummary.sum / usedLengths.length,
    minUsedLayers: lengthSummary.min,
    maxUsedLayers: lengthSummary.max,
  }

  const schematic = buildSchematicBlob(target, paletteIndexesByPixel, palette, settings)

  self.postMessage({
    type: 'done',
    schematicBlob: schematic.blob,
    fileName: schematicFileName(settings),
    stats: {
      ...stats,
      dimensions: `${schematic.metadata.width} x ${schematic.metadata.height} x ${schematic.metadata.length}`,
      schematicVolume: schematic.metadata.width * schematic.metadata.height * schematic.metadata.length,
      placedBlockCount: schematic.metadata.placedBlockCount,
    },
  })
}

self.onmessage = (event) => {
  if (event.data?.type === 'cancel') {
    cancelled = true
    return
  }

  if (event.data?.type !== 'generate') return

  generate(event.data).catch((error) => {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  })
}
