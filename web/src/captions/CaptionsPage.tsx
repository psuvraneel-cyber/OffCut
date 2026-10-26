import { useEffect, useRef, useState } from 'react'
import {
  createTranscriber,
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
  type CapabilityReport,
  type Progress,
  type Transcriber,
  type Transcript,
} from '@offcut/engine'
import { Logo } from '../components/Logo'
import './CaptionsPage.css'

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatMss(seconds: number): string {
  const totalSec = Math.floor(Math.max(0, seconds))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
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
  const [includeSoundCues, setIncludeSoundCues] = useState(false)
  const [step, setStep] = useState<'pick' | 'working' | 'result' | 'error'>('pick')
  const [statusText, setStatusText] = useState('')
  const [progressPercent, setProgressPercent] = useState<number | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [cues, setCues] = useState<CaptionCue[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const transcriberRef = useRef<Transcriber | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const downloadMapRef = useRef<Map<string, { loaded: number; total: number }>>(new Map())
  const isFirstUseRef = useRef(true)

  useEffect(() => {
    detectCapabilities().then(setCapabilities).catch(() => {})
  }, [])

  useEffect(() => {
    if (!transcriberRef.current) {
      transcriberRef.current = createTranscriber({ model: 'base' })
    }

    const onUnload = () => {
      transcriberRef.current?.dispose()
      transcriberRef.current = null
    }

    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      transcriberRef.current?.dispose()
      transcriberRef.current = null
    }
  }, [])

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

    if (!transcriberRef.current) {
      transcriberRef.current = createTranscriber({ model: 'base' })
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setStep('working')
    setStatusText('Preparing...')
    setProgressPercent(null)
    downloadMapRef.current.clear()

    try {
      const result = await transcriberRef.current.transcribe(file, {
        language: 'en',
        signal: abortController.signal,
        onProgress: (p: Progress) => {
          if (p.stage === 'download') {
            if (isFirstUseRef.current) {
              downloadMapRef.current.set(p.file, { loaded: p.loaded, total: p.total })
              let sumLoaded = 0
              let sumTotal = 0
              for (const item of downloadMapRef.current.values()) {
                sumLoaded += item.loaded
                sumTotal += item.total
              }
              const loadedMb = (sumLoaded / (1024 * 1024)).toFixed(1)
              const totalMb = (sumTotal / (1024 * 1024)).toFixed(1)
              setStatusText(`Downloading the speech model: ${loadedMb} MB of ${totalMb} MB (first time only)`)
              if (sumTotal > 0) {
                setProgressPercent(Math.min(100, Math.round((sumLoaded / sumTotal) * 100)))
              } else {
                setProgressPercent(null)
              }
            } else {
              setStatusText('Preparing...')
              setProgressPercent(null)
            }
          } else if (p.stage === 'load') {
            let isDownloading = false
            if (isFirstUseRef.current && downloadMapRef.current.size > 0) {
              for (const item of downloadMapRef.current.values()) {
                if (item.total === 0 || item.loaded < item.total) {
                  isDownloading = true
                  break
                }
              }
            }
            if (!isDownloading) {
              setStatusText('Preparing...')
              setProgressPercent(null)
            }
          } else if (p.stage === 'decode') {
            isFirstUseRef.current = false
            const sec = Math.round(p.seconds)
            const dur = Math.round(p.duration)
            setStatusText(`Reading audio: ${sec}s / ${dur}s`)
            if (p.duration > 0) {
              setProgressPercent(Math.min(100, Math.round((p.seconds / p.duration) * 100)))
            } else {
              setProgressPercent(null)
            }
          } else if (p.stage === 'transcribe') {
            isFirstUseRef.current = false
            const sec = Math.round(p.seconds)
            const dur = Math.round(p.duration)
            setStatusText(`Transcribing: ${sec}s / ${dur}s`)
            if (p.duration > 0) {
              setProgressPercent(Math.min(100, Math.round((p.seconds / p.duration) * 100)))
            } else {
              setProgressPercent(null)
            }
          }
        },
      })

      setTranscript(result)
      const generatedCues = buildCaptionCues(result.words, { includeSoundCues })
      setCues(generatedCues)
      setStep('result')
    } catch (err) {
      if (err instanceof AbortError || (err as Error)?.name === 'AbortError' || abortController.signal.aborted) {
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

  const handleStartOver = () => {
    setFile(null)
    setTranscript(null)
    setCues([])
    setErrorMessage('')
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
            <span className="captions-badge mono">English only for now.</span>
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
            {transcript?.language && transcript.language !== 'en' && (
              <div className="captions-warning" role="alert">
                Detected language: {transcript.language} (English only is supported; results may be poor).
              </div>
            )}

            {cues.length === 0 ? (
              <div className="captions-empty">
                <p>No speech found in this file.</p>
                <div className="captions-actions">
                  <button type="button" className="button button--secondary" onClick={handleStartOver}>
                    Start over
                  </button>
                </div>
              </div>
            ) : (
              <div className="captions-results-view">
                <div className="captions-toolbar">
                  <div className="captions-buttons-group">
                    <button
                      type="button"
                      className="button button--primary"
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

                <div className="captions-list">
                  {cues.map((cue, index) => {
                    const timeLabel = formatMss(cue.start)
                    const accessibleLabel = `Caption ${index + 1}, ${timeLabel}`
                    return (
                      <div key={index} className="captions-item">
                        <div className="captions-item__time mono">{timeLabel}</div>
                        <textarea
                          className="captions-item__textarea"
                          rows={2}
                          value={cue.text}
                          aria-label={accessibleLabel}
                          onChange={(e) => handleCueTextChange(index, e.target.value)}
                        />
                      </div>
                    )
                  })}
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
      </main>
    </div>
  )
}
