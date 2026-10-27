export type ReframingMode = 'original' | 'smart-9-16' | 'blur-9-16' | 'center-9-16'

export interface CropWindow {
  x: number
  y: number
  width: number
  height: number
}

export interface ReframingOption {
  id: ReframingMode
  name: string
  description: string
  icon: string
}

export const REFRAMING_OPTIONS: readonly ReframingOption[] = [
  {
    id: 'original',
    name: 'Original',
    description: 'Keep video at its original uploaded aspect ratio',
    icon: '↔️',
  },
  {
    id: 'smart-9-16',
    name: '9:16 Auto-Focus',
    description: 'AI active-speaker tracking with cinematic smooth panning',
    icon: '🎬',
  },
  {
    id: 'blur-9-16',
    name: '9:16 Blurred Backdrop',
    description: 'Centered widescreen video with zoomed, blurred background',
    icon: '🎙️',
  },
  {
    id: 'center-9-16',
    name: '9:16 Center Crop',
    description: 'Fixed center crop into vertical 9:16 format',
    icon: '✂️',
  },
]

export function isVerticalMode(mode: ReframingMode): boolean {
  return mode !== 'original'
}

/**
 * Calculates a 9:16 vertical crop window centered around centerX,
 * clamped within the video boundaries so no black bars appear.
 */
export function compute916CropWindow(
  videoWidth: number,
  videoHeight: number,
  centerX: number
): CropWindow {
  if (videoWidth <= 0 || videoHeight <= 0) {
    return { x: 0, y: 0, width: videoWidth, height: videoHeight }
  }

  // If already 9:16 or taller/narrower, no horizontal cropping needed
  if (videoWidth / videoHeight <= 9 / 16) {
    return { x: 0, y: 0, width: videoWidth, height: videoHeight }
  }

  const cropWidth = Math.min(videoWidth, Math.round(videoHeight * (9 / 16)))
  const cropHeight = videoHeight

  const minCenter = cropWidth / 2
  const maxCenter = videoWidth - cropWidth / 2
  const clampedCenter = Math.max(minCenter, Math.min(maxCenter, centerX))
  const cropX = Math.round(clampedCenter - cropWidth / 2)

  return {
    x: cropX,
    y: 0,
    width: cropWidth,
    height: cropHeight,
  }
}

/**
 * Draws the reframed video frame onto a canvas context according to the selected mode.
 */
export function drawReframedVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  mode: ReframingMode,
  targetWidth: number,
  targetHeight: number,
  centerX?: number
): void {
  const vidW = video.videoWidth || 1920
  const vidH = video.videoHeight || 1080

  if (mode === 'original') {
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight)
    return
  }

  if (mode === 'blur-9-16') {
    // 1. Zoomed, blurred background filling the full 9:16 canvas
    const scaleCover = Math.max(targetWidth / vidW, targetHeight / vidH)
    const coverW = vidW * scaleCover
    const coverH = vidH * scaleCover
    const coverX = (targetWidth - coverW) / 2
    const coverY = (targetHeight - coverH) / 2

    ctx.save()
    ctx.filter = 'blur(28px) brightness(0.55)'
    ctx.drawImage(video, coverX, coverY, coverW, coverH)
    ctx.restore()

    // 2. Crisp centered video
    const scaleFit = targetWidth / vidW
    const fitW = targetWidth
    const fitH = vidH * scaleFit
    const fitY = (targetHeight - fitH) / 2
    ctx.drawImage(video, 0, fitY, fitW, fitH)
    return
  }

  // mode === 'smart-9-16' or mode === 'center-9-16'
  const targetCenter = mode === 'center-9-16' || centerX === undefined ? vidW / 2 : centerX
  const crop = compute916CropWindow(vidW, vidH, targetCenter)

  ctx.drawImage(
    video,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    targetWidth,
    targetHeight
  )
}
