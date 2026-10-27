import type { CaptionCue, CaptionPacing, Word } from '@offcut/engine'

export type CaptionStylePreset =
  | 'viral'
  | 'beast'
  | 'fire'
  | 'comic'
  | 'neon'
  | 'clean'
  | 'classic'
export type CaptionPosition = 'bottom' | 'center' | 'top'
export type CaptionSize = 'sm' | 'md' | 'lg' | 'xl'
export type { CaptionPacing }

export interface CaptionStyleConfig {
  preset: CaptionStylePreset
  position: CaptionPosition
  highlightColor: string
  size: CaptionSize
  uppercase: boolean
  pacing: CaptionPacing
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
    name: 'Hormozi Pop',
    tagline: 'High impact black outline with electric yellow punch',
    defaultHighlight: '#FFE600',
    uppercase: true,
    hasPill: false,
  },
  {
    id: 'beast',
    name: 'Beast Neon',
    tagline: 'High energy, neon lime active word with deep drop shadow',
    defaultHighlight: '#00FF66',
    uppercase: true,
    hasPill: false,
  },
  {
    id: 'fire',
    name: 'Heatwave Red',
    tagline: 'Fiery coral active word, dramatic punch for high hooks',
    defaultHighlight: '#FF3355',
    uppercase: true,
    hasPill: false,
  },
  {
    id: 'comic',
    name: 'Marker Box',
    tagline: 'Bold highlighter badge behind active word (TikTok sticker style)',
    defaultHighlight: '#FFE600',
    uppercase: true,
    hasPill: false,
  },
  {
    id: 'neon',
    name: 'Cyber Glow',
    tagline: 'Cyan neon bloom with rounded dark cyber pill',
    defaultHighlight: '#00F0FF',
    uppercase: true,
    hasPill: true,
  },
  {
    id: 'clean',
    name: 'Frosted Glass',
    tagline: 'Modern luxury, rounded translucent frosted glass backdrop',
    defaultHighlight: '#C4B5FD',
    uppercase: false,
    hasPill: true,
  },
  {
    id: 'classic',
    name: 'Cinema Sub',
    tagline: 'Traditional movie subtitle with soft legible shadow',
    defaultHighlight: '#FFE600',
    uppercase: false,
    hasPill: false,
  },
]

export const HIGHLIGHT_COLORS = [
  { hex: '#FFE600', name: 'Viral Yellow' },
  { hex: '#00FF66', name: 'Electric Green' },
  { hex: '#00F0FF', name: 'Cyber Cyan' },
  { hex: '#FF3355', name: 'Coral Red' },
  { hex: '#A855F7', name: 'Vibrant Purple' },
  { hex: '#FF9900', name: 'Neon Orange' },
  { hex: '#FFFFFF', name: 'Pure White' },
] as const

export const DEFAULT_STYLE_CONFIG: CaptionStyleConfig = {
  preset: 'viral',
  position: 'bottom',
  highlightColor: '#FFE600',
  size: 'md',
  uppercase: true,
  pacing: 'viral',
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
  const rawWords = cue.text.replace(/\uFFFD/g, '').trim().split(/\s+/).filter(Boolean)
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
