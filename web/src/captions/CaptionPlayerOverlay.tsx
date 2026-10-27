import { useEffect, useState } from 'react'
import type { CaptionCue, Word } from '@offcut/engine'
import {
  getCueWords,
  type CaptionStyleConfig,
  type TimedWord,
} from './captionStyles'

interface CaptionPlayerOverlayProps {
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>
  cues: readonly CaptionCue[]
  transcriptWords?: readonly Word[]
  styleConfig: CaptionStyleConfig
}

export function CaptionPlayerOverlay({
  mediaRef,
  cues,
  transcriptWords,
  styleConfig,
}: CaptionPlayerOverlayProps) {
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const mediaElement = mediaRef.current
    if (!mediaElement) return

    let animId: number

    const tick = () => {
      if (!mediaElement.paused && !mediaElement.ended) {
        setCurrentTime(mediaElement.currentTime)
      }
      animId = requestAnimationFrame(tick)
    }

    const onPlay = () => {
      animId = requestAnimationFrame(tick)
    }
    const onPause = () => {
      cancelAnimationFrame(animId)
      setCurrentTime(mediaElement.currentTime)
    }
    const onSeek = () => {
      setCurrentTime(mediaElement.currentTime)
    }

    mediaElement.addEventListener('play', onPlay)
    mediaElement.addEventListener('pause', onPause)
    mediaElement.addEventListener('seeked', onSeek)
    mediaElement.addEventListener('timeupdate', onSeek)

    if (!mediaElement.paused) {
      animId = requestAnimationFrame(tick)
    }

    return () => {
      cancelAnimationFrame(animId)
      mediaElement.removeEventListener('play', onPlay)
      mediaElement.removeEventListener('pause', onPause)
      mediaElement.removeEventListener('seeked', onSeek)
      mediaElement.removeEventListener('timeupdate', onSeek)
    }
  }, [mediaRef])

  // Find active cue
  const activeCue = cues.find(
    (c) => currentTime >= c.start && currentTime <= c.end
  )

  if (!activeCue) {
    return null
  }

  const words: TimedWord[] = getCueWords(activeCue, transcriptWords)
  let activeWordIdx = words.findIndex(
    (w) => currentTime >= w.start && currentTime <= w.end
  )

  // If between words during cue duration, highlight the most recently started word
  if (activeWordIdx === -1 && words.length > 0) {
    for (let i = words.length - 1; i >= 0; i--) {
      if (currentTime >= words[i].start) {
        activeWordIdx = i
        break
      }
    }
    if (activeWordIdx === -1) activeWordIdx = 0
  }

  const positionClass = `captions-overlay--pos-${styleConfig.position}`
  const sizeClass = `captions-overlay--size-${styleConfig.size}`
  const presetClass = `captions-overlay--preset-${styleConfig.preset}`

  return (
    <div
      className={`captions-overlay ${positionClass} ${sizeClass} ${presetClass}`}
      style={
        {
          '--caption-highlight': styleConfig.highlightColor,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <div className="captions-overlay__box">
        {words.map((w, idx) => {
          const isActive = idx === activeWordIdx
          const displayText = styleConfig.uppercase
            ? w.text.toUpperCase()
            : w.text

          return (
            <span
              key={`${idx}-${w.text}`}
              className={`captions-overlay__word ${
                isActive ? 'captions-overlay__word--active' : ''
              }`}
              style={
                isActive && styleConfig.preset !== 'comic'
                  ? { color: styleConfig.highlightColor }
                  : undefined
              }
            >
              {displayText}
            </span>
          )
        })}
      </div>
    </div>
  )
}
