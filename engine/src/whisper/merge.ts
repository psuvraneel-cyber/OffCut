import type { Segment, WindowTranscript, Word } from "../types";
import { groupWordsIntoSegments, normalizeWords } from "./clean";

export { groupWordsIntoSegments } from "./clean";

export interface MergeDiagnosticInfo {
  cutPoints: Array<{
    windowA: number;
    windowB: number;
    cutSeconds: number;
    retainedA: number;
    retainedB: number;
    discardedA: number;
    discardedB: number;
  }>;
  totalAcceptedWords: number;
  finalNormalizedWords: number;
}

export function mergeWindowTranscripts(
  results: readonly WindowTranscript[],
  duration: number,
  diagnosticsOut?: { info?: MergeDiagnosticInfo },
): { granularity: "word" | "segment"; segments: Segment[]; words: Word[]; language?: string } {
  if (results.length === 0) {
    if (diagnosticsOut) {
      diagnosticsOut.info = {
        cutPoints: [],
        totalAcceptedWords: 0,
        finalNormalizedWords: 0,
      };
    }
    return { granularity: "word", segments: [], words: [] };
  }

  const sortedResults = [...results].sort(
    (left, right) => left.window.start - right.window.start || left.window.index - right.window.index,
  );

  const granularity = sortedResults.some((result) => result.granularity === "segment") ? "segment" : "word";
  const language = sortedResults.map((result) => result.language).find((value) => Boolean(value));

  const cutPointsRecord: Array<{
    windowA: number;
    windowB: number;
    cutSeconds: number;
    retainedA: number;
    retainedB: number;
    discardedA: number;
    discardedB: number;
  }> = [];

  if (granularity === "segment") {
    const acceptedSegments: Segment[] = [];
    for (let index = 0; index < sortedResults.length; index += 1) {
      const current = sortedResults[index];
      const prev = index > 0 ? sortedResults[index - 1] : null;
      const next = index + 1 < sortedResults.length ? sortedResults[index + 1] : null;

      const lowerCut = prev ? (current.window.start + prev.window.end) / 2 : -Infinity;
      const upperCut = next ? (next.window.start + current.window.end) / 2 : Infinity;

      for (const segment of current.segments) {
        const absStart = segment.start + current.window.start;
        const absEnd = segment.end + current.window.start;
        const midpoint = (absStart + absEnd) / 2;

        if (midpoint >= lowerCut && midpoint < upperCut) {
          acceptedSegments.push({
            text: segment.text,
            start: Math.min(absStart, absEnd),
            end: Math.max(absStart, absEnd),
            words: segment.words.map((word) => ({
              text: word.text,
              start: word.start + current.window.start,
              end: word.end + current.window.start,
              ...(word.kind ? { kind: word.kind } : {}),
            })),
          });
        }
      }
    }

    acceptedSegments.sort((left, right) => left.start - right.start || left.end - right.end);
    const words = acceptedSegments.flatMap((segment) => segment.words);
    if (diagnosticsOut) {
      diagnosticsOut.info = {
        cutPoints: cutPointsRecord,
        totalAcceptedWords: words.length,
        finalNormalizedWords: words.length,
      };
    }
    return { granularity: "segment", segments: acceptedSegments, words, language };
  }

  const acceptedWords: Word[] = [];
  for (let index = 0; index < sortedResults.length; index += 1) {
    const current = sortedResults[index];
    const prev = index > 0 ? sortedResults[index - 1] : null;
    const next = index + 1 < sortedResults.length ? sortedResults[index + 1] : null;

    const lowerCut = prev ? (current.window.start + prev.window.end) / 2 : -Infinity;
    const upperCut = next ? (next.window.start + current.window.end) / 2 : Infinity;

    let retainedFromCurrent = 0;
    let discardedFromCurrent = 0;

    for (const word of current.words) {
      const absStart = word.start + current.window.start;
      const absEnd = word.end + current.window.start;
      const midpoint = (absStart + absEnd) / 2;

      if (midpoint >= lowerCut && midpoint < upperCut) {
        retainedFromCurrent++;
        acceptedWords.push({
          text: word.text,
          start: absStart,
          end: absEnd,
          ...(word.kind ? { kind: word.kind } : {}),
        });
      } else {
        discardedFromCurrent++;
      }
    }

    if (prev) {
      cutPointsRecord.push({
        windowA: prev.window.index,
        windowB: current.window.index,
        cutSeconds: lowerCut,
        retainedA: 0, // already recorded
        retainedB: retainedFromCurrent,
        discardedA: 0,
        discardedB: discardedFromCurrent,
      });
    }
  }

  const normalizedWords = normalizeWords(acceptedWords, duration);
  const segments = groupWordsIntoSegments(normalizedWords);

  if (diagnosticsOut) {
    diagnosticsOut.info = {
      cutPoints: cutPointsRecord,
      totalAcceptedWords: acceptedWords.length,
      finalNormalizedWords: normalizedWords.length,
    };
  }

  return {
    granularity: "word",
    segments,
    words: normalizedWords,
    language,
  };
}
