import type { CaptionLanguage } from "../types";

export type ScriptType = "latin" | "devanagari" | "perso_arabic" | "tamil" | "other" | "symbol";

// Perso-Arabic covers Arabic, Urdu, Persian, Shahmukhi
const PERSO_ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// Tamil script
const TAMIL_REGEX = /[\u0B80-\u0BFF]/;

// Devanagari script (Hindi, Marathi, Sanskrit, Nepali)
const DEVANAGARI_REGEX = /[\u0900-\u097F\uA8E0-\uA8FF]/;

// Latin script (English, Spanish, etc.)
const LATIN_REGEX = /[a-zA-Z\u00C0-\u024F]/;

// Other non-target scripts often found in Whisper cross-lingual hallucinations
const OTHER_FOREIGN_SCRIPTS_REGEX = /[\u0400-\u04FF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

/**
 * Classifies the predominant script of a given token or word.
 */
export function detectWordScript(text: string): ScriptType {
  if (PERSO_ARABIC_REGEX.test(text)) {
    return "perso_arabic";
  }
  if (TAMIL_REGEX.test(text)) {
    return "tamil";
  }
  if (DEVANAGARI_REGEX.test(text)) {
    return "devanagari";
  }
  if (LATIN_REGEX.test(text)) {
    return "latin";
  }
  if (OTHER_FOREIGN_SCRIPTS_REGEX.test(text)) {
    return "other";
  }
  return "symbol";
}

/**
 * Checks whether a word is permissible for a given target transcription language.
 *
 * - "en": Only Latin letters, digits, and punctuation. Devanagari, Urdu, Tamil, etc. are rejected.
 * - "hi": Devanagari and Latin loanwords are permitted. Urdu, Tamil, and other foreign scripts are rejected.
 * - "hinglish": Devanagari and Latin are permitted. Urdu, Tamil, and other foreign scripts are rejected.
 * - "auto": By default, reject Perso-Arabic and Tamil hallucinations when dealing with general English/Hindi content.
 */
export function isWordAllowedInLanguage(text: string, language: CaptionLanguage = "auto"): boolean {
  const script = detectWordScript(text);

  // Symbols, numbers, and punctuation are always permitted
  if (script === "symbol") {
    return true;
  }

  // Perso-Arabic (Urdu) and Tamil are NEVER permitted in standard English, Hindi, or Hinglish captions
  if (script === "perso_arabic" || script === "tamil" || script === "other") {
    return false;
  }

  if (language === "en") {
    // English captions should not contain Devanagari
    return script === "latin";
  }

  if (language === "hi" || language === "hinglish") {
    // Both Devanagari and Latin (English loanwords like "broker", "interview", "app") are permitted
    return script === "devanagari" || script === "latin";
  }

  // In auto mode, Latin and Devanagari are accepted, but Urdu/Tamil hallucinations are suppressed
  return script === "latin" || script === "devanagari";
}

/**
 * Returns true if the text contains any forbidden foreign script characters
 * (such as Perso-Arabic / Urdu or Tamil in Hindi/English/Hinglish mode).
 */
export function hasForeignScript(text: string, language: CaptionLanguage = "auto"): boolean {
  if (PERSO_ARABIC_REGEX.test(text) || TAMIL_REGEX.test(text) || OTHER_FOREIGN_SCRIPTS_REGEX.test(text)) {
    return true;
  }
  if (language === "en" && DEVANAGARI_REGEX.test(text)) {
    return true;
  }
  return false;
}

/**
 * Counts how many words in a window transcript contain forbidden foreign script.
 */
export function countForeignScriptWords(
  words: readonly { text: string }[],
  language: CaptionLanguage = "auto",
): number {
  let count = 0;
  for (const word of words) {
    if (!isWordAllowedInLanguage(word.text, language)) {
      count++;
    }
  }
  return count;
}

/**
 * Strips out words that contain forbidden foreign scripts.
 */
export function filterForeignScriptWords<T extends { text: string; kind?: string }>(
  words: readonly T[],
  language: CaptionLanguage = "auto",
): T[] {
  return words.filter((w) => w.kind === "cue" || isWordAllowedInLanguage(w.text, language));
}
