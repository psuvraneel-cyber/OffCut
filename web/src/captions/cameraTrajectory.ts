import type { CaptionCue, Word } from '@offcut/engine'
import type { VideoFaceScanSample, DetectedFace } from './faceDetector'
import { compute916CropWindow } from './reframing'

export interface CameraTrajectoryPoint {
  time: number
  centerX: number // in video pixels
  isCut: boolean
  speakerLabel: string
  faceCount: number
}

export interface CameraTrajectory {
  getCenterAt(timeInSeconds: number): number
  getSpeakerStatusAt(timeInSeconds: number): {
    label: string
    faceCount: number
  }
}

/**
 * Builds a smooth, cinematic camera trajectory following the active speaking face.
 */
export function buildCameraTrajectory(
  videoWidth: number,
  videoHeight: number,
  samples: readonly VideoFaceScanSample[],
  cues?: readonly CaptionCue[],
  transcriptWords?: readonly Word[]
): CameraTrajectory {
  const defaultCenter = videoWidth / 2

  if (!samples || samples.length === 0) {
    return {
      getCenterAt: () => defaultCenter,
      getSpeakerStatusAt: () => ({ label: 'Center View', faceCount: 0 }),
    }
  }

  // Pre-calculate speech intervals from cues or words
  const isSpeechActive = (time: number): boolean => {
    if (transcriptWords && transcriptWords.length > 0) {
      return transcriptWords.some(
        (w) => time >= w.start - 0.2 && time <= w.end + 0.2 && w.kind !== 'cue'
      )
    }
    if (cues && cues.length > 0) {
      return cues.some((c) => time >= c.start - 0.2 && time <= c.end + 0.2)
    }
    return true
  }

  // 1. Raw target calculation for each sampled frame
  const rawPoints: {
    time: number
    targetX: number
    isCut: boolean
    speakerLabel: string
    faceCount: number
  }[] = []

  let lastActiveFaceIdx = 0
  let prevSampleFaces: DetectedFace[] = []

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const faces = s.faces
    const speaking = isSpeechActive(s.time)

    let targetNormX = 0.5
    let speakerLabel = 'Center'
    const faceCount = faces.length

    if (faceCount === 0) {
      targetNormX = 0.5
      speakerLabel = 'Wide Shot'
    } else if (faceCount === 1) {
      // Single person on screen
      const f = faces[0]
      targetNormX = f.box.x + f.box.width / 2
      speakerLabel = speaking ? 'Active Speaker' : 'Subject'
      lastActiveFaceIdx = 0
    } else {
      // Multiple characters (e.g. Character A vs Character B)
      // Sort left to right
      const sorted = [...faces].sort((a, b) => a.box.x - b.box.x)

      if (speaking) {
        // Measure mouth-to-nose openness if keypoints available
        let bestFaceIdx = -1
        let maxMovement = -1

        for (let fIdx = 0; fIdx < sorted.length; fIdx++) {
          const f = sorted[fIdx]
          if (f.mouthCenter && f.noseTip) {
            const mouthDist = Math.abs(f.mouthCenter.y - f.noseTip.y)
            if (mouthDist > maxMovement) {
              maxMovement = mouthDist
              bestFaceIdx = fIdx
            }
          }
        }

        // If mouth movement wasn't distinctly differentiated, alternate based on time/cues
        if (bestFaceIdx === -1) {
          const cueIdx = cues?.findIndex((c) => s.time >= c.start && s.time <= c.end) ?? -1
          bestFaceIdx = cueIdx >= 0 ? cueIdx % sorted.length : lastActiveFaceIdx
        }

        lastActiveFaceIdx = bestFaceIdx
        const targetFace = sorted[bestFaceIdx] || sorted[0]
        targetNormX = targetFace.box.x + targetFace.box.width / 2
        speakerLabel = `Speaker ${bestFaceIdx + 1}`
      } else {
        // Keep focus on the last active speaker
        const targetFace = sorted[lastActiveFaceIdx] || sorted[0]
        targetNormX = targetFace.box.x + targetFace.box.width / 2
        speakerLabel = 'Listening'
      }
    }

    // Shot cut detection: large abrupt shift between consecutive samples
    let isCut = false
    if (i > 0 && prevSampleFaces.length > 0 && faceCount > 0) {
      const prevCenter =
        prevSampleFaces[0].box.x + prevSampleFaces[0].box.width / 2
      if (Math.abs(targetNormX - prevCenter) > 0.35) {
        isCut = true
      }
    }

    rawPoints.push({
      time: s.time,
      targetX: targetNormX * videoWidth,
      isCut,
      speakerLabel,
      faceCount,
    })

    prevSampleFaces = faces
  }

  // 2. Cinematic smoothing pass (Virtual Cameraman)
  const trajectoryPoints: CameraTrajectoryPoint[] = []
  let smoothedX = rawPoints[0]?.targetX ?? defaultCenter

  // Calculate 9:16 crop window constraints
  const cropBounds = compute916CropWindow(videoWidth, videoHeight, defaultCenter)
  const halfCropW = cropBounds.width / 2
  const minX = halfCropW
  const maxX = videoWidth - halfCropW

  const deadbandPixels = videoWidth * 0.025 // 2.5% deadband to prevent micro-jitter

  for (let i = 0; i < rawPoints.length; i++) {
    const pt = rawPoints[i]

    if (pt.isCut || i === 0) {
      // Instant camera cut on scene change
      smoothedX = pt.targetX
    } else {
      const delta = pt.targetX - smoothedX
      if (Math.abs(delta) > deadbandPixels) {
        // Smooth cinematic glide toward target speaker
        smoothedX += delta * 0.16
      }
    }

    // Clamp within video boundaries so 9:16 frame never clips outside video
    const clampedCenter = Math.max(minX, Math.min(maxX, smoothedX))

    trajectoryPoints.push({
      time: pt.time,
      centerX: Math.round(clampedCenter),
      isCut: pt.isCut,
      speakerLabel: pt.speakerLabel,
      faceCount: pt.faceCount,
    })
  }

  // 3. Fast lookup function
  return {
    getCenterAt(timeInSeconds: number): number {
      if (trajectoryPoints.length === 0) return defaultCenter
      if (timeInSeconds <= trajectoryPoints[0].time) {
        return trajectoryPoints[0].centerX
      }
      if (timeInSeconds >= trajectoryPoints[trajectoryPoints.length - 1].time) {
        return trajectoryPoints[trajectoryPoints.length - 1].centerX
      }

      // Binary search for surrounding points
      let low = 0
      let high = trajectoryPoints.length - 1

      while (low <= high) {
        const mid = (low + high) >> 1
        const pt = trajectoryPoints[mid]
        if (pt.time === timeInSeconds) return pt.centerX
        if (pt.time < timeInSeconds) low = mid + 1
        else high = mid - 1
      }

      const p1 = trajectoryPoints[Math.max(0, high)]
      const p2 = trajectoryPoints[Math.min(trajectoryPoints.length - 1, low)]

      if (p2.isCut || p1.time === p2.time) {
        return p2.centerX
      }

      // Linear interpolation between trajectory points
      const fraction = (timeInSeconds - p1.time) / (p2.time - p1.time)
      return Math.round(p1.centerX + (p2.centerX - p1.centerX) * fraction)
    },

    getSpeakerStatusAt(timeInSeconds: number) {
      if (trajectoryPoints.length === 0) {
        return { label: 'Center View', faceCount: 0 }
      }
      // Find closest sample point
      let closest = trajectoryPoints[0]
      let minDiff = Math.abs(timeInSeconds - closest.time)

      for (const pt of trajectoryPoints) {
        const diff = Math.abs(timeInSeconds - pt.time)
        if (diff < minDiff) {
          minDiff = diff
          closest = pt
        }
      }

      return {
        label: closest.speakerLabel,
        faceCount: closest.faceCount,
      }
    },
  }
}
