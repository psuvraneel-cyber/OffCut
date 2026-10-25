import type { RawTimedText, Word, WindowSegment, WindowWord } from "../types";

const ARTEFACT = /^(?:\[(?:blank[_ ]audio|music|applause|laughter|silence|noise|inaudible)\]|\((?:applause|music|laughter|silence|noise)\))$/i;

export const MIN_WORD_SECONDS = 0.08;

export function cleanWords(raw: readonly RawTimedText[], duration: number): Word[] {
  const merged = mergeLeadingSpaceTokens(raw);
  const words: Word[] = [];

  for (const item of merged) {
    const text = item.text.trim();
    if (!text || ARTEFACT.test(text)) {
      continue;
    }

    const start = clampTimestamp(item.start ?? 0, duration);
    const end = clampTimestamp(item.end ?? start, duration);
    words.push({
      text,
      start: Math.min(start, end),
      end: Math.max(start, end),
    });
  }

  return normalizeWords(words, duration);
}

export function cleanSegments(raw: readonly RawTimedText[], duration: number): WindowSegment[] {
  const segments: WindowSegment[] = [];

  for (const item of raw) {
    const text = item.text.trim();
    if (!text || ARTEFACT.test(text)) {
      continue;
    }

    const start = clampTimestamp(item.start ?? 0, duration);
    const end = clampTimestamp(item.end ?? start, duration);
    const segmentStart = Math.min(start, end);
    const segmentEnd = Math.max(start, end);
    const segmentWords = distributeSegmentWords(text, segmentStart, segmentEnd);

    segments.push({
      text,
      start: segmentStart,
      end: segmentEnd,
      words: segmentWords,
    });
  }

  return segments;
}

export function normalizeWords(words: readonly WindowWord[], duration: number): WindowWord[] {
  if (words.length === 0) {
    return [];
  }

  const sorted: WindowWord[] = words
    .filter((word) => word.text.trim().length > 0)
    .map((word) => {
      const start = clampTimestamp(word.start, duration);
      const end = clampTimestamp(word.end, duration);
      return {
        text: word.text.trim(),
        start: Math.min(start, end),
        end: Math.max(start, end),
      };
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (sorted.length === 0) {
    return [];
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];

    if (previous.end > current.start) {
      const overlap = previous.end - current.start;
      const prevDuration = previous.end - previous.start;

      if (overlap > prevDuration / 2) {
        const mid = (current.start + previous.end) / 2;
        previous.end = mid;
        current.start = mid;
      } else {
        previous.end = current.start;
      }
    }
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const word = sorted[index];
    if (word.end - word.start < MIN_WORD_SECONDS) {
      const nextWordStart = index + 1 < sorted.length ? sorted[index + 1].start : duration;
      const maxEnd = Math.min(word.start + MIN_WORD_SECONDS, nextWordStart, duration);
      if (maxEnd > word.end) {
        word.end = maxEnd;
      }

      if (word.end - word.start < MIN_WORD_SECONDS) {
        const prevWordEnd = index > 0 ? sorted[index - 1].end : 0;
        const minStart = Math.max(word.end - MIN_WORD_SECONDS, prevWordEnd, 0);
        if (minStart < word.start) {
          word.start = minStart;
        }
      }
    }
  }

  return sorted;
}

export function groupWordsIntoSegments(words: readonly WindowWord[]): WindowSegment[] {
  const segments: WindowSegment[] = [];
  for (const word of words) {
    const previous = segments.at(-1);
    const shouldStartNew =
      !previous ||
      word.start - previous.end > 1.25 ||
      /[.!?]$/.test(previous.text);
    if (shouldStartNew) {
      segments.push({ text: word.text, start: word.start, end: word.end, words: [{ ...word }] });
    } else {
      previous.text = `${previous.text} ${word.text}`;
      previous.end = word.end;
      previous.words.push({ ...word });
    }
  }
  return segments;
}

function mergeLeadingSpaceTokens(raw: readonly RawTimedText[]): RawTimedText[] {
  const merged: RawTimedText[] = [];

  for (const item of raw) {
    const text = item.text;
    const startsWithWhitespace = /^\s/.test(text);
    const previous = merged.at(-1);
    const isArtefact = text.trim().length === 0 || ARTEFACT.test(text.trim());

    if (previous && !startsWithWhitespace && !isArtefact && previous.text.trim().length > 0) {
      previous.text += text;
      previous.end = item.end ?? previous.end;
    } else {
      merged.push({ ...item });
    }
  }

  return merged;
}

function distributeSegmentWords(text: string, start: number, end: number): Word[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return [];
  }

  const duration = Math.max(0, end - start);
  return parts.map((part, index) => {
    const wordStart = start + (duration * index) / parts.length;
    const wordEnd = start + (duration * (index + 1)) / parts.length;
    return { text: part, start: wordStart, end: wordEnd };
  });
}

function clampTimestamp(value: number, duration: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), Math.max(0, duration));
}
