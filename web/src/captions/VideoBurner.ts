import type { CaptionCue, Word } from '@offcut/engine'
import {
  getCueWords,
  type CaptionStyleConfig,
  type TimedWord,
} from './captionStyles'

export interface BurnVideoOptions {
  videoFile: File
  cues: readonly CaptionCue[]
  transcriptWords?: readonly Word[]
  styleConfig: CaptionStyleConfig
  onProgress?: (progress: {
    currentSeconds: number
    totalSeconds: number
    fraction: number
  }) => void
  signal?: AbortSignal
}

export interface BurnVideoResult {
  blob: Blob
  mimeType: string
  extension: string
}

interface WrappedLine {
  words: {
    word: TimedWord
    isActive: boolean
    text: string
    width: number
  }[]
  totalWidth: number
}

/**
 * Draws the active styled caption and word highlight on a 2D canvas context.
 */
export function drawCaptionOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  currentTime: number,
  cues: readonly CaptionCue[],
  transcriptWords: readonly Word[] | undefined,
  styleConfig: CaptionStyleConfig
): void {
  const activeCue = cues.find(
    (c) => currentTime >= c.start && currentTime <= c.end
  )
  if (!activeCue) return

  const words = getCueWords(activeCue, transcriptWords)
  if (words.length === 0) return

  let activeWordIdx = words.findIndex(
    (w) => currentTime >= w.start && currentTime <= w.end
  )
  if (activeWordIdx === -1) {
    for (let i = words.length - 1; i >= 0; i--) {
      if (currentTime >= words[i].start) {
        activeWordIdx = i
        break
      }
    }
    if (activeWordIdx === -1) activeWordIdx = 0
  }

  // Responsive font size based on canvas width (e.g. 1080p base)
  const sizeMultipliers: Record<string, number> = {
    sm: 0.038,
    md: 0.05,
    lg: 0.065,
    xl: 0.082,
  }
  const fontSize = Math.max(
    20,
    Math.round(width * (sizeMultipliers[styleConfig.size] || 0.05))
  )
  const lineHeight = fontSize * 1.25

  ctx.save()
  ctx.font = `900 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
  ctx.textBaseline = 'middle'

  const spaceWidth = ctx.measureText(' ').width
  const maxLineWidth = width * 0.86

  // Wrap words into lines
  const lines: WrappedLine[] = []
  let currentLineWords: WrappedLine['words'] = []
  let currentLineWidth = 0

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const text = styleConfig.uppercase ? w.text.toUpperCase() : w.text
    const wordWidth = ctx.measureText(text).width
    const needed = currentLineWords.length === 0 ? wordWidth : spaceWidth + wordWidth

    if (currentLineWidth + needed <= maxLineWidth || currentLineWords.length === 0) {
      currentLineWords.push({
        word: w,
        isActive: i === activeWordIdx,
        text,
        width: wordWidth,
      })
      currentLineWidth += needed
    } else {
      lines.push({ words: currentLineWords, totalWidth: currentLineWidth })
      currentLineWords = [
        {
          word: w,
          isActive: i === activeWordIdx,
          text,
          width: wordWidth,
        },
      ]
      currentLineWidth = wordWidth
    }
  }

  if (currentLineWords.length > 0) {
    lines.push({ words: currentLineWords, totalWidth: currentLineWidth })
  }

  // Vertical position
  const totalBlockHeight = lines.length * lineHeight
  let startY: number
  if (styleConfig.position === 'top') {
    startY = height * 0.14
  } else if (styleConfig.position === 'center') {
    startY = height * 0.5 - totalBlockHeight / 2
  } else {
    // bottom
    startY = height * 0.80 - totalBlockHeight / 2
  }

  // Draw pill background if preset calls for it
  if (styleConfig.preset === 'clean' || styleConfig.preset === 'neon') {
    const maxLineW = Math.max(...lines.map((l) => l.totalWidth))
    const padX = fontSize * 0.8
    const padY = fontSize * 0.45
    const pillX = (width - maxLineW) / 2 - padX
    const pillY = startY - padY
    const pillW = maxLineW + padX * 2
    const pillH = totalBlockHeight + padY * 2
    const radius = Math.min(24, fontSize * 0.45)

    ctx.fillStyle =
      styleConfig.preset === 'neon'
        ? 'rgba(8, 6, 20, 0.85)'
        : 'rgba(18, 12, 34, 0.82)'

    ctx.beginPath()
    ctx.roundRect(pillX, pillY, pillW, pillH, radius)
    ctx.fill()

    if (styleConfig.preset === 'neon') {
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)'
      ctx.lineWidth = Math.max(1.5, fontSize * 0.04)
      ctx.stroke()
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.lineWidth = Math.max(1, fontSize * 0.03)
      ctx.stroke()
    }
  }

  // Draw words
  lines.forEach((line, lineIdx) => {
    let currentX = (width - line.totalWidth) / 2
    const lineY = startY + lineIdx * lineHeight + lineHeight / 2

    line.words.forEach((item) => {
      ctx.save()

      if (item.isActive) {
        if (styleConfig.preset === 'comic') {
          // Marker Box highlight behind active word
          const padX = fontSize * 0.22
          const padY = fontSize * 0.08
          const bgX = currentX - padX
          const bgY = lineY - lineHeight / 2 + padY
          const bgW = item.width + padX * 2
          const bgH = lineHeight - padY * 2
          const rad = Math.min(8, fontSize * 0.2)

          ctx.fillStyle = styleConfig.highlightColor
          ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
          ctx.shadowBlur = 8
          ctx.shadowOffsetY = 3
          ctx.beginPath()
          ctx.roundRect(bgX, bgY, bgW, bgH, rad)
          ctx.fill()

          ctx.shadowColor = 'transparent'
          ctx.fillStyle = '#000000'
          ctx.fillText(item.text, currentX, lineY)
        } else {
          ctx.fillStyle = styleConfig.highlightColor

          if (styleConfig.preset === 'neon') {
            ctx.shadowColor = styleConfig.highlightColor
            ctx.shadowBlur = fontSize * 0.45
          } else {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.95)'
            ctx.shadowBlur = 8
            ctx.shadowOffsetY = 2
          }

          if (styleConfig.preset !== 'clean') {
            // Heavy punchy outline
            ctx.strokeStyle = '#000000'
            ctx.lineWidth = Math.max(3.5, fontSize * 0.16)
            ctx.lineJoin = 'round'
            ctx.strokeText(item.text, currentX, lineY)
          }

          ctx.fillText(item.text, currentX, lineY)
        }
      } else {
        ctx.fillStyle = '#FFFFFF'
        if (styleConfig.preset !== 'clean') {
          ctx.strokeStyle = '#000000'
          ctx.lineWidth = Math.max(2.8, fontSize * 0.13)
          ctx.lineJoin = 'round'
          ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'
          ctx.shadowBlur = 4
          ctx.shadowOffsetY = 2
          ctx.strokeText(item.text, currentX, lineY)
        } else {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
          ctx.shadowBlur = 4
        }
        ctx.fillText(item.text, currentX, lineY)
      }

      ctx.restore()
      currentX += item.width + spaceWidth
    })
  })

  ctx.restore()
}

/**
 * Renders video frames with styled captions and encodes directly into an MP4/WebM video file.
 */
export async function burnVideoWithCaptions(
  options: BurnVideoOptions
): Promise<BurnVideoResult> {
  const { videoFile, cues, transcriptWords, styleConfig, onProgress, signal } =
    options

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Your browser does not support in-browser video recording.')
  }

  // Detect supported format
  const mimeType =
    [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ].find((type) => MediaRecorder.isTypeSupported(type)) || 'video/webm'

  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'

  // Create offscreen container
  const container = document.createElement('div')
  container.style.cssText =
    'position: fixed; left: -9999px; top: -9999px; width: 1px; height: 1px; opacity: 0; pointer-events: none;'
  document.body.appendChild(container)

  const video = document.createElement('video')
  video.src = URL.createObjectURL(videoFile)
  video.muted = false
  video.playsInline = true
  video.crossOrigin = 'anonymous'
  container.appendChild(video)

  let audioCtx: AudioContext | null = null
  let streamDest: MediaStreamAudioDestinationNode | null = null

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Failed to load video file.'))
    })

    if (signal?.aborted) throw new Error('Export cancelled')

    const width = video.videoWidth || 1280
    const height = video.videoHeight || 720
    const duration = video.duration || 1

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    container.appendChild(canvas)

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Could not create 2D canvas context.')

    // Setup audio capture
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      audioCtx = new AudioContextClass()
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }
      const source = audioCtx.createMediaElementSource(video)
      streamDest = audioCtx.createMediaStreamDestination()
      source.connect(streamDest)
    } catch (audioErr) {
      console.warn('Audio capture not available, exporting video without audio:', audioErr)
    }

    // Combine tracks
    const canvasStream = canvas.captureStream(30)
    const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()]
    if (streamDest && streamDest.stream.getAudioTracks().length > 0) {
      combinedTracks.push(...streamDest.stream.getAudioTracks())
    }
    const combinedStream = new MediaStream(combinedTracks)

    const recordedChunks: BlobPart[] = []
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    })

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data)
    }

    // Render loop
    video.currentTime = 0
    await video.play()
    recorder.start(100)

    await new Promise<void>((resolve, reject) => {
      const cleanupListeners = () => {
        video.onended = null
        video.onerror = null
      }

      const onFrame = () => {
        if (signal?.aborted) {
          cleanupListeners()
          recorder.stop()
          video.pause()
          reject(new Error('Export cancelled'))
          return
        }

        if (video.ended || video.currentTime >= duration) {
          cleanupListeners()
          resolve()
          return
        }

        // Draw video frame
        ctx.drawImage(video, 0, 0, width, height)

        // Draw styled captions
        drawCaptionOnCanvas(
          ctx,
          width,
          height,
          video.currentTime,
          cues,
          transcriptWords,
          styleConfig
        )

        // Report progress
        onProgress?.({
          currentSeconds: video.currentTime,
          totalSeconds: duration,
          fraction: Math.min(1, video.currentTime / duration),
        })

        if ('requestVideoFrameCallback' in video) {
          video.requestVideoFrameCallback(onFrame)
        } else {
          requestAnimationFrame(onFrame)
        }
      }

      video.onended = () => {
        cleanupListeners()
        resolve()
      }
      video.onerror = (e) => {
        cleanupListeners()
        reject(e)
      }

      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(onFrame)
      } else {
        requestAnimationFrame(onFrame)
      }
    })

    // Finalize recording
    const blobPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(recordedChunks, { type: mimeType }))
      }
    })
    recorder.stop()
    const finalBlob = await blobPromise

    return {
      blob: finalBlob,
      mimeType,
      extension,
    }
  } finally {
    // Cleanup DOM and streams
    video.pause()
    URL.revokeObjectURL(video.src)
    if (audioCtx) {
      void audioCtx.close()
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }
}
