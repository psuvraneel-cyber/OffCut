import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

export interface DetectedFace {
  box: {
    x: number // 0..1 normalized
    y: number // 0..1 normalized
    width: number // 0..1 normalized
    height: number // 0..1 normalized
  }
  confidence: number
  mouthCenter?: { x: number; y: number }
  noseTip?: { x: number; y: number }
  leftEye?: { x: number; y: number }
  rightEye?: { x: number; y: number }
}

export interface VideoFaceScanSample {
  time: number // in seconds
  faces: DetectedFace[]
}

export interface ScanProgress {
  scannedSeconds: number
  totalSeconds: number
  fraction: number
}

let detectorPromise: Promise<FaceDetector> | null = null

/**
 * Initializes and caches the MediaPipe FaceDetector.
 */
export async function getFaceDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      )
      return FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.45,
      })
    })().catch((err) => {
      detectorPromise = null
      throw err
    })
  }
  return detectorPromise
}

/**
 * Scans video frames at regular intervals (e.g. every 250ms) to detect face positions
 * and keypoints for active-speaker tracking.
 */
export async function scanVideoFaces(
  videoFile: File,
  options?: {
    sampleIntervalSeconds?: number
    onProgress?: (progress: ScanProgress) => void
    signal?: AbortSignal
  }
): Promise<VideoFaceScanSample[]> {
  const sampleInterval = options?.sampleIntervalSeconds ?? 0.25
  const samples: VideoFaceScanSample[] = []

  let detector: FaceDetector | null = null
  try {
    detector = await getFaceDetector()
  } catch (err) {
    console.warn('MediaPipe FaceDetector failed to initialize, using center heuristics fallback:', err)
  }

  // Create offscreen video element
  const video = document.createElement('video')
  video.src = URL.createObjectURL(videoFile)
  video.muted = true
  video.playsInline = true
  video.crossOrigin = 'anonymous'

  // Small offscreen canvas for fast detection
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Could not load video for face scanning.'))
    })

    const duration = video.duration || 1
    const vidW = video.videoWidth || 1280
    const vidH = video.videoHeight || 720

    // Set detection canvas to 480px width for fast inference
    const detectW = 480
    const detectH = Math.round((detectW / vidW) * vidH)
    canvas.width = detectW
    canvas.height = detectH

    if (!detector || !ctx) {
      // Fallback: single centered face estimate
      return [
        {
          time: 0,
          faces: [
            {
              box: { x: 0.35, y: 0.2, width: 0.3, height: 0.4 },
              confidence: 0.9,
            },
          ],
        },
      ]
    }

    const totalSteps = Math.ceil(duration / sampleInterval)
    let currentTime = 0

    const seekTo = (time: number) =>
      new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        video.currentTime = Math.min(duration, time)
      })

    let step = 0
    while (currentTime <= duration) {
      if (options?.signal?.aborted) {
        throw new Error('Face scanning cancelled')
      }

      await seekTo(currentTime)

      // Draw downscaled frame
      ctx.drawImage(video, 0, 0, detectW, detectH)

      const result = detector.detect(canvas)
      const detectedFaces: DetectedFace[] = []

      for (const det of result.detections) {
        if (!det.boundingBox) continue
        const b = det.boundingBox

        // Normalize to 0..1
        const normBox = {
          x: Math.max(0, b.originX / detectW),
          y: Math.max(0, b.originY / detectH),
          width: Math.min(1, b.width / detectW),
          height: Math.min(1, b.height / detectH),
        }

        const confidence = det.categories?.[0]?.score ?? 0.5

        let mouthCenter: { x: number; y: number } | undefined
        let noseTip: { x: number; y: number } | undefined
        let rightEye: { x: number; y: number } | undefined
        let leftEye: { x: number; y: number } | undefined

        if (det.keypoints) {
          // MediaPipe keypoints: 0=rightEye, 1=leftEye, 2=noseTip, 3=mouthCenter
          if (det.keypoints[0]) rightEye = { x: det.keypoints[0].x, y: det.keypoints[0].y }
          if (det.keypoints[1]) leftEye = { x: det.keypoints[1].x, y: det.keypoints[1].y }
          if (det.keypoints[2]) noseTip = { x: det.keypoints[2].x, y: det.keypoints[2].y }
          if (det.keypoints[3]) mouthCenter = { x: det.keypoints[3].x, y: det.keypoints[3].y }
        }

        detectedFaces.push({
          box: normBox,
          confidence,
          mouthCenter,
          noseTip,
          leftEye,
          rightEye,
        })
      }

      samples.push({
        time: currentTime,
        faces: detectedFaces,
      })

      step++
      options?.onProgress?.({
        scannedSeconds: currentTime,
        totalSeconds: duration,
        fraction: Math.min(1, step / totalSteps),
      })

      currentTime += sampleInterval
    }

    return samples
  } finally {
    video.pause()
    URL.revokeObjectURL(video.src)
  }
}
