interface ExportProgressModalProps {
  isOpen: boolean
  currentSeconds: number
  totalSeconds: number
  fraction: number
  status: 'rendering' | 'finishing' | 'done' | 'error'
  errorMessage?: string
  onCancel: () => void
  onClose: () => void
}

export function ExportProgressModal({
  isOpen,
  currentSeconds,
  totalSeconds,
  fraction,
  status,
  errorMessage,
  onCancel,
  onClose,
}: ExportProgressModalProps) {
  if (!isOpen) return null

  const percent = Math.min(100, Math.round(fraction * 100))
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="captions-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
      <div className="captions-modal">
        <h3 id="export-modal-title" className="captions-modal__title">
          {status === 'error'
            ? 'Export Failed'
            : status === 'done'
            ? 'Export Complete! 🎬'
            : 'Burning Captions into Video'}
        </h3>

        {status === 'error' ? (
          <div className="captions-modal__content">
            <p className="captions-modal__error">
              {errorMessage || 'An error occurred during video rendering.'}
            </p>
            <div className="captions-modal__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        ) : status === 'done' ? (
          <div className="captions-modal__content">
            <p className="captions-modal__success">
              Your captioned video has been rendered and your download should start automatically!
            </p>
            <div className="captions-modal__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="captions-modal__content">
            <p className="captions-modal__hint">
              {status === 'finishing'
                ? 'Finalizing video file...'
                : `Rendering frame by frame: ${formatTime(currentSeconds)} / ${formatTime(totalSeconds)}`}
            </p>

            <div
              className="captions-progress-bar captions-modal__progress"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="captions-progress-bar__fill"
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="captions-modal__stat">
              <span>{percent}% completed</span>
              <span className="captions-modal__subtext">
                Runs 100% on your device
              </span>
            </div>

            <div className="captions-modal__actions">
              <button
                type="button"
                className="button button--secondary button--danger"
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
