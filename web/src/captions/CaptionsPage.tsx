import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createTranscriptionStage,
  detectCapabilities,
  buildCaptionCues,
  toSrt,
  toVtt,
  AbortError,
  GpuLostError,
  ModelLoadError,
  NoAudioTrackError,
  OutOfMemoryError,
  UnsupportedFormatError,
  type CaptionCue,
  type CaptionLanguage,
  type CapabilityReport,
  type Transcript,
  type ModelSize,
} from '@offcut/engine'
import { createRuntime, RuntimeAbortError, type JobProgress } from '@offcut/runtime'
import { Logo } from '../components/Logo'
import { CaptionPlayerOverlay } from './CaptionPlayerOverlay'
import {
  DEFAULT_STYLE_CONFIG,
  HIGHLIGHT_COLORS,
  STYLE_PRESETS,
  type CaptionStyleConfig,
  type CaptionStylePreset,
} from './captionStyles'
import { ExportProgressModal } from './ExportProgressModal'
import { burnVideoWithCaptions } from './VideoBurner'
import './CaptionsPage.css'

interface LanguageOption {
  id: CaptionLanguage
  label: string
  hint: string
  badge?: string
}

const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  {
    id: 'auto',
    label: 'Auto Detect',
    hint: 'Identifies speech language automatically from the first frames.',
  },
  {
    id: 'en',
    label: 'English',
    hint: 'Optimized for English speech recognition with standard punctuation.',
  },
  {
    id: 'hi',
    label: 'Hindi (हिंदी)',
    hint: 'Generates clean Devanagari captions with Purna Viram (।) punctuation.',
    badge: 'Devanagari',
  },
  {
    id: 'hinglish',
    label: 'Hinglish',
    hint: 'Bilingual Indian speech mixing Hindi and English, outputted in Roman script.',
    badge: 'Romanized',
  },
] as const

function formatLanguageLabel(detected?: string, requested?: CaptionLanguage): string {
  const code = (detected || requested || 'auto').toLowerCase()
  if (code === 'hinglish') return 'Hinglish (Hindi + English)'
  if (code === 'hi') return 'Hindi (हिंदी)'
  if (code === 'en') return 'English'
  if (code === 'auto') return 'Auto (Detected)'
  return `Language: ${code}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTime(seconds: number): string {
  const totalSec = Math.max(0, seconds)
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  const tenths = Math.floor((totalSec % 1) * 10)
  return `${m}:${String(s).padStart(2, '0')}.${tenths}`
}

function getBaseFilename(file: File | null): string {
  if (!file) return 'captions'
  const name = file.name
  const lastDot = name.lastIndexOf('.')
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof UnsupportedFormatError || (error as Error)?.name === 'UnsupportedFormatError') {
    return "This file format isn't supported. Try MP4, WebM, MP3, WAV, OGG or FLAC."
  }
  if (error instanceof NoAudioTrackError || (error as Error)?.name === 'NoAudioTrackError') {
    return 'This file has no sound.'
  }
  if (error instanceof ModelLoadError || (error as Error)?.name === 'ModelLoadError') {
    return "The speech model couldn't load. Check your connection and try again."
  }
  if (error instanceof OutOfMemoryError || (error as Error)?.name === 'OutOfMemoryError') {
    return (error as Error)?.message || 'Out of memory during decoding.'
  }
  if (error instanceof GpuLostError || (error as Error)?.name === 'GpuLostError') {
    return 'Your graphics processor stopped responding. Try again; it will use the CPU.'
  }
  console.error('Transcription error:', error)
  return 'Something went wrong. Try again.'
}

export function CaptionsPage() {
  const [capabilities, setCapabilities] = useState<CapabilityReport | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [language, setLanguage] = useState<CaptionLanguage>('auto')
  const [model, setModel] = useState<ModelSize>(() => {
    try {
      const saved = localStorage.getItem('offcut_preferred_model')
      if (saved === 'base' || saved === 'small') return saved
    } catch {}
    return 'base'
  })
  const [includeSoundCues, setIncludeSoundCues] = useState(false)
  const [step, setStep] = useState<'pick' | 'working' | 'result' | 'error'>('pick')
  const [statusText, setStatusText] = useState('')
  const [progressPercent, setProgressPercent] = useState<number | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [cues, setCues] = useState<CaptionCue[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [activeCueIndex, setActiveCueIndex] = useState<number | null>(null)
  const [styleConfig, setStyleConfig] = useState<CaptionStyleConfig>(DEFAULT_STYLE_CONFIG)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportProgress, setExportProgress] = useState({ currentSeconds: 0, totalSeconds: 1, fraction: 0 })
  const [exportStatus, setExportStatus] = useState<'rendering' | 'finishing' | 'done' | 'error'>('rendering')
  const [exportError, setExportError] = useState('')
  const exportAbortRef = useRef<AbortController | null>(null)

  const mediaUrl = useMemo(() => {
    if (!file) return null
    return URL.createObjectURL(file)
  }, [file])

  useEffect(() => {
    return () => {
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
      }
    }
  }, [mediaUrl])

  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([])

  useEffect(() => {
    detectCapabilities().then(setCapabilities).catch(() => {})
  }, [])

  const handleModelChange = (newModel: ModelSize) => {
    if (newModel === model) return
    setModel(newModel)
    try {
      localStorage.setItem('offcut_preferred_model', newModel)
    } catch {}
  }

  const handleLanguageKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    let nextIndex = currentIndex
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (currentIndex + 1) % LANGUAGE_OPTIONS.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (currentIndex - 1 + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length
    } else {
      return
    }
    const nextOption = LANGUAGE_OPTIONS[nextIndex]
    setLanguage(nextOption.id)
    const buttons = document.querySelectorAll<HTMLButtonElement>('.captions-lang-group button[role="radio"]')
    buttons[nextIndex]?.focus()
  }

  const handleFileSelected = (selectedFile: File) => {
    setFile(selectedFile)
    setErrorMessage('')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0])
    }
  }

  const handleStartTranscribing = async () => {
    if (!file) return

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setStep('working')
    setStatusText('Preparing...')
    setProgressPercent(null)

    try {
      const runtime = createRuntime()
      const stage = createTranscriptionStage({
        model,
        language,
        vad: true,
      })

      const result = await runtime.runJob<Transcript>([stage], file, {
        signal: abortController.signal,
        onProgress: (p: JobProgress) => {
          if (p.detail) {
            setStatusText(p.detail)
          }
          setProgressPercent(Math.min(100, Math.round(p.fraction * 100)))
        },
      })

      setTranscript(result)
      const generatedCues = buildCaptionCues(result.words, { includeSoundCues })
      setCues(generatedCues)
      setStep('result')
    } catch (err) {
      if (
        err instanceof RuntimeAbortError ||
        err instanceof AbortError ||
        (err as Error)?.name === 'AbortError' ||
        abortController.signal.aborted
      ) {
        setStep('pick')
        return
      }
      setErrorMessage(getErrorMessage(err))
      setStep('error')
    } finally {
      abortControllerRef.current = null
    }
  }

  const handleCancel = () => {
    abortControllerRef.current?.abort()
    setStep('pick')
  }

  const handleCueTextChange = (index: number, newText: string) => {
    setCues((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], text: newText }
      return next
    })
  }

  const handleTimeUpdate = () => {
    if (!mediaRef.current) return
    const time = mediaRef.current.currentTime
    const idx = cues.findIndex((c) => time >= c.start && time <= c.end)
    setActiveCueIndex(idx !== -1 ? idx : null)
  }

  const handleSeekTo = (time: number) => {
    if (mediaRef.current) {
      mediaRef.current.currentTime = Math.max(0, time)
      mediaRef.current.play().catch(() => {})
    }
  }

  const handleTimeChange = (index: number, field: 'start' | 'end', val: number) => {
    if (isNaN(val) || val < 0) return
    setCues((prev) => {
      const next = [...prev]
      const cur = next[index]
      if (!cur) return prev
      if (field === 'start') {
        const newStart = Number(val.toFixed(2))
        const newEnd = Math.max(newStart + 0.1, cur.end)
        next[index] = { ...cur, start: newStart, end: Number(newEnd.toFixed(2)) }
      } else {
        const newEnd = Number(val.toFixed(2))
        const newStart = Math.min(cur.start, Math.max(0, newEnd - 0.1))
        next[index] = { ...cur, start: Number(newStart.toFixed(2)), end: newEnd }
      }
      return next
    })
  }

  const handleInsertCue = (afterIndex: number) => {
    setCues((prev) => {
      const next = [...prev]
      if (afterIndex === -1) {
        const firstStart = next[0] ? next[0].start : 2.0
        const newEnd = Number(Math.max(0.5, firstStart).toFixed(2))
        const newStart = Number(Math.max(0, newEnd - 1.5).toFixed(2))
        next.unshift({ start: newStart, end: newEnd, text: '' })
        return next
      }

      const cur = next[afterIndex]
      const following = next[afterIndex + 1]
      const start = Number(cur.end.toFixed(2))
      let end: number
      if (following && following.start > start + 0.2) {
        end = Number(following.start.toFixed(2))
      } else {
        end = Number((start + 2.0).toFixed(2))
      }

      next.splice(afterIndex + 1, 0, {
        start,
        end,
        text: '',
      })
      return next
    })
  }

  const handleDeleteCue = (index: number) => {
    setCues((prev) => prev.filter((_, i) => i !== index))
  }

  const handleMergeWithNext = (index: number) => {
    setCues((prev) => {
      if (index >= prev.length - 1) return prev
      const next = [...prev]
      const cur = next[index]
      const following = next[index + 1]
      const mergedText = `${cur.text.trim()} ${following.text.trim()}`.trim()
      const mergedCue: CaptionCue = {
        start: cur.start,
        end: following.end,
        text: mergedText,
      }
      next.splice(index, 2, mergedCue)
      return next
    })
  }

  const handleSplitCue = (index: number) => {
    setCues((prev) => {
      const cur = prev[index]
      if (!cur) return prev
      const text = cur.text.trim()
      if (!text) return prev

      const textareaEl = textareaRefs.current[index]
      let left = ''
      let right = ''

      if (textareaEl && typeof textareaEl.selectionStart === 'number') {
        const pos = textareaEl.selectionStart
        if (pos > 0 && pos < text.length) {
          left = text.slice(0, pos).trim()
          right = text.slice(pos).trim()
        }
      }

      if (!left || !right) {
        const words = text.split(/\s+/)
        if (words.length <= 1) {
          const mid = Math.ceil(text.length / 2)
          left = text.slice(0, mid).trim()
          right = text.slice(mid).trim()
        } else {
          const mid = Math.ceil(words.length / 2)
          left = words.slice(0, mid).join(' ')
          right = words.slice(mid).join(' ')
        }
      }

      const duration = Math.max(0.4, cur.end - cur.start)
      const ratio = left.length + right.length > 0 ? left.length / (left.length + right.length) : 0.5
      const clampedRatio = Math.max(0.2, Math.min(0.8, ratio))
      const splitTime = Number((cur.start + duration * clampedRatio).toFixed(2))

      const cue1: CaptionCue = { start: cur.start, end: splitTime, text: left }
      const cue2: CaptionCue = { start: splitTime, end: cur.end, text: right }

      const next = [...prev]
      next.splice(index, 1, cue1, cue2)
      return next
    })
  }

  const handleDownloadSrt = () => {
    const srtContent = toSrt(cues)
    const filename = `${getBaseFilename(file)}.srt`
    triggerDownload(srtContent, filename, 'application/x-subrip')
  }

  const handleDownloadVtt = () => {
    const vttContent = toVtt(cues)
    const filename = `${getBaseFilename(file)}.vtt`
    triggerDownload(vttContent, filename, 'text/vtt')
  }

  const handleCopyText = async () => {
    const allText = cues.map((c) => c.text).join('\n')
    try {
      await navigator.clipboard.writeText(allText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text:', err)
    }
  }

  const handlePresetChange = (presetId: CaptionStylePreset) => {
    const found = STYLE_PRESETS.find((p) => p.id === presetId)
    if (!found) return
    setStyleConfig((prev) => ({
      ...prev,
      preset: presetId,
      highlightColor: found.defaultHighlight,
      uppercase: found.uppercase,
    }))
  }

  const handleBurnAndDownload = async () => {
    if (!file) return
    const abortController = new AbortController()
    exportAbortRef.current = abortController
    setExportModalOpen(true)
    setExportStatus('rendering')
    setExportProgress({ currentSeconds: 0, totalSeconds: 1, fraction: 0 })
    setExportError('')

    try {
      const result = await burnVideoWithCaptions({
        videoFile: file,
        cues,
        transcriptWords: transcript?.words,
        styleConfig,
        signal: abortController.signal,
        onProgress: (p) => {
          setExportProgress(p)
          if (p.fraction >= 0.99) {
            setExportStatus('finishing')
          }
        },
      })

      setExportStatus('done')
      const baseName = file.name.replace(/\.[^/.]+$/, '')
      const downloadUrl = URL.createObjectURL(result.blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `${baseName}_captioned.${result.extension}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000)
    } catch (err) {
      if (exportAbortRef.current?.signal.aborted) {
        setExportModalOpen(false)
        return
      }
      setExportStatus('error')
      setExportError((err as Error)?.message || 'Export failed')
    } finally {
      exportAbortRef.current = null
    }
  }

  const handleCancelExport = () => {
    exportAbortRef.current?.abort()
    setExportModalOpen(false)
  }

  const handleStartOver = () => {
    if (exportAbortRef.current) {
      exportAbortRef.current.abort()
      exportAbortRef.current = null
    }
    setExportModalOpen(false)
    if (mediaRef.current) {
      mediaRef.current.pause()
    }
    setFile(null)
    setTranscript(null)
    setCues([])
    setErrorMessage('')
    setActiveCueIndex(null)
    setStep('pick')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="captions-page">
      <header className="captions-header">
        <div className="captions-header__inner">
          <a className="captions-header__logo" href="/" aria-label="Offcut home">
            <Logo />
          </a>
          <a className="captions-header__back" href="/">
            ← Back to Offcut
          </a>
        </div>
      </header>

      <main className="captions-main">
        <section className="captions-intro">
          <h1 className="captions-title">Free captions file</h1>
          <p className="captions-subtitle">
            Your video never leaves your device. The speech model runs in your browser.
          </p>
          <div className="captions-note-row">
            <span className="captions-badge mono">Now supporting English, Hindi & Hinglish</span>
          </div>
        </section>

        {capabilities && (
          <div className="captions-capabilities" aria-live="polite">
            {!capabilities.webgpu && (
              <p className="captions-notice">Your browser will use the CPU. It works, but it's slower.</p>
            )}
            {!capabilities.webcodecsAudio && (
              <p className="captions-notice">
                This browser decodes some formats slowly; files over 200 MB may not work.
              </p>
            )}
          </div>
        )}

        {step === 'pick' && (
          <section className="captions-card" aria-label="Upload video or audio">
            <div className="captions-lang-section">
              <div className="captions-lang-header">
                <span className="captions-lang-label">Speech language</span>
                <span className="captions-lang-badge mono">Multilingual WebGPU</span>
              </div>
              <div
                className="captions-lang-group"
                role="radiogroup"
                aria-label="Speech language"
              >
                {LANGUAGE_OPTIONS.map((opt, index) => {
                  const isSelected = language === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      className={`captions-lang-pill ${isSelected ? 'captions-lang-pill--active' : ''}`}
                      onClick={() => setLanguage(opt.id)}
                      onKeyDown={(e) => handleLanguageKeyDown(e, index)}
                    >
                      <span className="captions-lang-pill__label">{opt.label}</span>
                      {opt.badge && <span className="captions-lang-pill__tag">{opt.badge}</span>}
                    </button>
                  )
                })}
              </div>
              <p className="captions-lang-hint" aria-live="polite">
                {LANGUAGE_OPTIONS.find((o) => o.id === language)?.hint}
              </p>
            </div>

            <div className="captions-model-selector" role="radiogroup" aria-label="Speech recognition model">
              <div className="captions-model-header">
                <span className="captions-model-label">Accuracy & Model:</span>
                <span className="captions-model-sublabel">Runs 100% on your device</span>
              </div>
              <div className="captions-model-options">
                <button
                  type="button"
                  role="radio"
                  aria-checked={model === 'base'}
                  className={`captions-model-card ${model === 'base' ? 'captions-model-card--active' : ''}`}
                  onClick={() => handleModelChange('base')}
                >
                  <div className="captions-model-card__title">
                    <span className="captions-model-card__radio" />
                    <span className="captions-model-card__name">Base Model</span>
                    <span className="captions-model-card__pill">Fast</span>
                  </div>
                  <p className="captions-model-card__desc">
                    ~181 MB download. Fastest processing; ideal for clean podcasts and quick clips.
                  </p>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={model === 'small'}
                  className={`captions-model-card ${model === 'small' ? 'captions-model-card--active' : ''}`}
                  onClick={() => handleModelChange('small')}
                >
                  <div className="captions-model-card__title">
                    <span className="captions-model-card__radio" />
                    <span className="captions-model-card__name">Small Model</span>
                    <span className="captions-model-card__pill captions-model-card__pill--highlight">
                      {capabilities?.webgpu ? 'Recommended for Shorts' : 'High Accuracy'}
                    </span>
                  </div>
                  <p className="captions-model-card__desc">
                    ~460 MB download. 3× model capacity; vastly superior on background music, fast speech, and slang.
                  </p>
                </button>
              </div>

              {language === 'hinglish' && model === 'base' && (
                <p className="captions-model-recommendation-hint">
                  💡 <strong>Tip for Hinglish:</strong> If your video has laughter, auditorium echo, or fast dialogue, select <strong>Small Model</strong> above for maximum accuracy.
                </p>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFileSelected(e.target.files[0])
                }
              }}
            />

            <button
              type="button"
              className={`captions-dropzone ${isDragging ? 'captions-dropzone--active' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              aria-label={file ? `Selected file: ${file.name}. Click to choose another file.` : 'Choose or drop a video or audio file'}
            >
              <div className="captions-dropzone__icon" aria-hidden="true">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="captions-dropzone__prompt">
                {file ? 'Click or drop to replace file' : 'Click to choose a video or audio file, or drag and drop here'}
              </p>
              <p className="captions-dropzone__sub">MP4, WebM, MP3, WAV, OGG, or FLAC</p>
            </button>

            {file && (
              <div className="captions-file-info">
                <span className="captions-file-name">{file.name}</span>
                <span className="captions-file-size mono">{formatFileSize(file.size)}</span>
              </div>
            )}

            <div className="captions-options">
              <label className="captions-checkbox-label">
                <input
                  type="checkbox"
                  checked={includeSoundCues}
                  onChange={(e) => setIncludeSoundCues(e.target.checked)}
                />
                <span>Include sound cues like (laughing)</span>
              </label>
            </div>

            <div className="captions-actions">
              <button
                type="button"
                className="button button--primary captions-submit-btn"
                disabled={!file}
                onClick={handleStartTranscribing}
              >
                Make captions
              </button>
            </div>
          </section>
        )}

        {step === 'working' && (
          <section className="captions-card" aria-label="Transcription in progress">
            <div className="captions-working">
              <div
                className="captions-progress-bar"
                role="progressbar"
                aria-valuenow={progressPercent ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={statusText}
              >
                <div
                  className={`captions-progress-bar__fill ${progressPercent === null ? 'captions-progress-bar__fill--indeterminate' : ''}`}
                  style={{ width: progressPercent !== null ? `${progressPercent}%` : '100%' }}
                />
              </div>

              <div className="captions-status" aria-live="polite">
                <p className="captions-status-text">{statusText}</p>
              </div>

              <div className="captions-actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={handleCancel}
                >
                  Cancel
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 'result' && (
          <section className="captions-card" aria-label="Captions result">
            <div className="captions-result-header">
              <div className="captions-result-badges">
                <span className="captions-badge-lang mono">
                  <span className="captions-dot" aria-hidden="true" />
                  {formatLanguageLabel(transcript?.language, language)}
                </span>
                {transcript?.stats && (
                  <span className="captions-badge-stat mono">
                    {transcript.stats.device.toUpperCase()} • {transcript.stats.realTimeFactor > 0 ? `${transcript.stats.realTimeFactor.toFixed(1)}x realtime` : 'WebGPU'}
                  </span>
                )}
              </div>
            </div>

            {transcript?.language &&
              !['en', 'hi', 'hinglish'].includes(transcript.language.toLowerCase()) && (
                <div className="captions-warning" role="alert">
                  Detected language: {transcript.language} (English, Hindi, and Hinglish are officially optimized).
                </div>
              )}

            {mediaUrl && (
              <div className="captions-preview-card">
                <div className="captions-preview-player-wrap">
                  {file?.type.startsWith('audio/') ? (
                    <audio
                      ref={mediaRef as React.RefObject<HTMLAudioElement>}
                      src={mediaUrl}
                      controls
                      onTimeUpdate={handleTimeUpdate}
                      className="captions-preview-audio"
                    />
                  ) : (
                    <video
                      ref={mediaRef as React.RefObject<HTMLVideoElement>}
                      src={mediaUrl}
                      controls
                      playsInline
                      onTimeUpdate={handleTimeUpdate}
                      className="captions-preview-video"
                    />
                  )}
                  <CaptionPlayerOverlay
                    mediaRef={mediaRef}
                    cues={cues}
                    transcriptWords={transcript?.words}
                    styleConfig={styleConfig}
                  />
                </div>
                <div className="captions-preview-hint">
                  Tip: Click the time button (e.g. ▶ 0:02.4) on any caption to jump to that moment in the video.
                </div>
                {cues.length > 0 && !file?.type.startsWith('audio/') && (
                  <div className="captions-style-card">
                    <div className="captions-style-row">
                      <span className="captions-style-label">Style:</span>
                      <div className="captions-style-pills">
                        {STYLE_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={`captions-style-pill ${
                              styleConfig.preset === preset.id
                                ? 'captions-style-pill--active'
                                : ''
                            }`}
                            onClick={() => handlePresetChange(preset.id)}
                          >
                            {preset.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="captions-style-row">
                      <span className="captions-style-label">Position:</span>
                      <div className="captions-style-pills">
                        {(['bottom', 'center', 'top'] as const).map((pos) => (
                          <button
                            key={pos}
                            type="button"
                            className={`captions-style-pill ${
                              styleConfig.position === pos
                                ? 'captions-style-pill--active'
                                : ''
                            }`}
                            onClick={() =>
                              setStyleConfig((prev) => ({
                                ...prev,
                                position: pos,
                              }))
                            }
                          >
                            {pos.charAt(0).toUpperCase() + pos.slice(1)}
                          </button>
                        ))}
                      </div>

                      <span
                        className="captions-style-label"
                        style={{ minWidth: 'auto', marginLeft: 'auto' }}
                      >
                        Size:
                      </span>
                      <div className="captions-style-pills">
                        {(['sm', 'md', 'lg'] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={`captions-style-pill ${
                              styleConfig.size === s
                                ? 'captions-style-pill--active'
                                : ''
                            }`}
                            onClick={() =>
                              setStyleConfig((prev) => ({ ...prev, size: s }))
                            }
                          >
                            {s.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="captions-style-row">
                      <span className="captions-style-label">Highlight:</span>
                      <div className="captions-color-swatches">
                        {HIGHLIGHT_COLORS.map((c) => (
                          <button
                            key={c.hex}
                            type="button"
                            className={`captions-color-swatch ${
                              styleConfig.highlightColor === c.hex
                                ? 'captions-color-swatch--active'
                                : ''
                            }`}
                            style={{ backgroundColor: c.hex }}
                            title={c.name}
                            onClick={() =>
                              setStyleConfig((prev) => ({
                                ...prev,
                                highlightColor: c.hex,
                              }))
                            }
                          />
                        ))}
                      </div>

                      <button
                        type="button"
                        className={`captions-style-pill ${
                          styleConfig.uppercase
                            ? 'captions-style-pill--active'
                            : ''
                        }`}
                        style={{ marginLeft: 'auto' }}
                        onClick={() =>
                          setStyleConfig((prev) => ({
                            ...prev,
                            uppercase: !prev.uppercase,
                          }))
                        }
                      >
                        {styleConfig.uppercase ? 'ALL CAPS' : 'Original Case'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {cues.length === 0 ? (
              <div className="captions-empty">
                <p>No speech found in this file.</p>
                <div className="captions-actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => handleInsertCue(-1)}
                  >
                    + Add a caption manually
                  </button>
                  <button type="button" className="button button--secondary" onClick={handleStartOver}>
                    Start over
                  </button>
                </div>
              </div>
            ) : (
              <div className="captions-results-view">
                <div className="captions-toolbar">
                  <div className="captions-buttons-group">
                    {!file?.type.startsWith('audio/') && (
                      <button
                        type="button"
                        className="button button--primary captions-burn-btn"
                        onClick={handleBurnAndDownload}
                      >
                        🎬 Burn & Download Video
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={handleDownloadSrt}
                    >
                      Download SRT
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={handleDownloadVtt}
                    >
                      Download VTT
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={handleCopyText}
                      aria-live="polite"
                    >
                      {copied ? 'Copied' : 'Copy text'}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="button button--ghost-dark"
                    onClick={handleStartOver}
                  >
                    Start over
                  </button>
                </div>

                <div className="captions-list-header">
                  <span className="captions-list-count">
                    {cues.length} {cues.length === 1 ? 'caption' : 'captions'}
                  </span>
                  <button
                    type="button"
                    className="captions-action-btn captions-action-btn--header"
                    onClick={() => handleInsertCue(-1)}
                  >
                    + Add caption at start
                  </button>
                </div>

                <div className="captions-list">
                  {cues.map((cue, index) => {
                    const accessibleLabel = `Caption ${index + 1}, ${formatTime(cue.start)} to ${formatTime(cue.end)}`
                    const isActive = activeCueIndex === index
                    return (
                      <div
                        key={index}
                        className={`captions-item ${isActive ? 'captions-item--active' : ''}`}
                      >
                        <div className="captions-item__header">
                          <div className="captions-item__timing">
                            <button
                              type="button"
                              className="captions-item__play-btn"
                              onClick={() => handleSeekTo(cue.start)}
                              title="Play video from this caption"
                            >
                              <span className="captions-item__play-icon" aria-hidden="true">▶</span>
                              <span>{formatTime(cue.start)} → {formatTime(cue.end)}</span>
                            </button>

                            <div className="captions-item__time-adjusters">
                              <label className="captions-time-field" title="Start time in seconds">
                                <span className="captions-time-field__label">Start</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  value={cue.start}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value)
                                    if (!isNaN(val)) handleTimeChange(index, 'start', val)
                                  }}
                                  className="captions-time-field__input mono"
                                />
                                <span className="captions-time-field__unit">s</span>
                              </label>
                              <label className="captions-time-field" title="End time in seconds">
                                <span className="captions-time-field__label">End</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  value={cue.end}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value)
                                    if (!isNaN(val)) handleTimeChange(index, 'end', val)
                                  }}
                                  className="captions-time-field__input mono"
                                />
                                <span className="captions-time-field__unit">s</span>
                              </label>
                            </div>
                          </div>

                          <div className="captions-item__actions">
                            <button
                              type="button"
                              className="captions-action-btn"
                              title="Split into two captions at cursor or midpoint"
                              onClick={() => handleSplitCue(index)}
                            >
                              ✂ Split
                            </button>
                            <button
                              type="button"
                              className="captions-action-btn"
                              title="Insert a new caption right after this one"
                              onClick={() => handleInsertCue(index)}
                            >
                              + Insert
                            </button>
                            <button
                              type="button"
                              className="captions-action-btn"
                              title="Merge with next caption"
                              disabled={index >= cues.length - 1}
                              onClick={() => handleMergeWithNext(index)}
                            >
                              ↓ Merge
                            </button>
                            <button
                              type="button"
                              className="captions-action-btn captions-action-btn--delete"
                              title="Delete this caption"
                              onClick={() => handleDeleteCue(index)}
                              aria-label={`Delete caption ${index + 1}`}
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <textarea
                          ref={(el) => {
                            textareaRefs.current[index] = el
                          }}
                          className="captions-item__textarea"
                          rows={2}
                          value={cue.text}
                          aria-label={accessibleLabel}
                          placeholder="Enter caption text..."
                          onChange={(e) => handleCueTextChange(index, e.target.value)}
                        />
                      </div>
                    )
                  })}
                </div>

                <div className="captions-list-footer">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => handleInsertCue(cues.length - 1)}
                  >
                    + Add caption at end
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {step === 'error' && (
          <section className="captions-card captions-card--error" aria-label="Error">
            <div className="captions-error-box" role="alert">
              <p className="captions-error-message">{errorMessage}</p>
              <div className="captions-actions">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => setStep('pick')}
                >
                  Try again
                </button>
              </div>
            </div>
          </section>
        )}

        <ExportProgressModal
          isOpen={exportModalOpen}
          currentSeconds={exportProgress.currentSeconds}
          totalSeconds={exportProgress.totalSeconds}
          fraction={exportProgress.fraction}
          status={exportStatus}
          errorMessage={exportError}
          onCancel={handleCancelExport}
          onClose={() => setExportModalOpen(false)}
        />
      </main>
    </div>
  )
}
