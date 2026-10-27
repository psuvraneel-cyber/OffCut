import type { CaptionCue, Word } from '@offcut/engine'

export type CaptionStylePreset = 'viral' | 'beast' | 'neon' | 'clean' | 'classic'
export type CaptionPosition = 'bottom' | 'center' | 'top'
export type CaptionSize = 'sm' | 'md' | 'lg'

export interface CaptionStyleConfig {
  preset: CaptionStylePreset
  position: CaptionPosition
  highlightColor: string
  size: CaptionSize
  uppercase: boolean
}

export interface PresetDetails {
  id: CaptionStylePreset
  name: string
  tagline: string
  defaultHighlight: string
  uppercase: boolean
  hasPill: boolean
}

export const STYLE_PRESETS: readonly PresetDetails[] = [
  {
    id: 'viral',
    name: 'Viral Pop',
    tagline: 'Bold punchy font, yellow highlight, heavy stroke',
    defaultHighlight: '#FFE600',
    uppercase: true,
    hasPill: false,
  },
  {
    id: 'beast',
    name: 'Beast Green',
    tagline: 'High energy, neon green active word, dark shadow',
    defaultHighlight: '#00FF66',
    uppercase: true,
    hasPill: false,
  },
  {
    id: 'neon',
    name: 'Neon Signal',
    tagline: 'Cyber glow, cyan active word with soft dark pill',
    defaultHighlight: '#6FE3FF',
    uppercase: true,
    hasPill: true,
  },
  {
    id: 'clean',
    name: 'Clean Box',
    tagline: 'Modern minimal, rounded translucent backdrop',
    defaultHighlight: '#C9B8FF',
    uppercase: false,
    hasPill: true,
  },
  {
    id: 'classic',
    name: 'Classic Sub',
    tagline: 'Traditional bottom subtitles with solid drop shadow',
    defaultHighlight: '#FFE600',
    uppercase: false,
    hasPill: false,
  },
]

export const HIGHLIGHT_COLORS = [
  { hex: '#FFE600', name: 'Yellow' },
  { hex: '#00FF66', name: 'Neon Green' },
  { hex: '#6FE3FF', name: 'Signal Cyan' },
  { hex: '#D77BFF', name: 'Orchid' },
  { hex: '#FF5C8A', name: 'Coral Pink' },
  { hex: '#FFFFFF', name: 'Pure White' },
] as const

export const DEFAULT_STYLE_CONFIG: CaptionStyleConfig = {
  preset: 'viral',
  position: 'bottom',
  highlightColor: '#FFE600',
  size: 'md',
  uppercase: true,
}

export interface TimedWord {
  text: string
  start: number
  end: number
}

/**
 * Maps a CaptionCue to its constituent words with millisecond timestamps.
 * If Whisper word timings match, uses exact timestamps; otherwise smoothly interpolates across cue duration.
 */
export function getCueWords(cue: CaptionCue, transcriptWords?: readonly Word[]): TimedWord[] {
  const rawWords = cue.text.trim().split(/\s+/).filter(Boolean)
  if (rawWords.length === 0) return []

  if (transcriptWords && transcriptWords.length > 0) {
    // Find words belonging to this cue time range
    const matched = transcriptWords.filter(
      (w) => w.start >= cue.start - 0.15 && w.end <= cue.end + 0.15 && w.kind !== 'cue'
    )
    if (matched.length === rawWords.length) {
      return matched.map((w, idx) => ({
        text: rawWords[idx],
        start: w.start,
        end: w.end,
      }))
    }
  }

  // Graceful linear interpolation for manual edits or unmatched cues
  const duration = Math.max(0.1, cue.end - cue.start)
  const wordDuration = duration / rawWords.length
  return rawWords.map((word, idx) => ({
    text: word,
    start: cue.start + idx * wordDuration,
    end: cue.start + (idx + 1) * wordDuration,
  }))
}
