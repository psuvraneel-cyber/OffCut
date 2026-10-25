export const SCORING_CONSTANTS = {
  maxFullMatrixElements: 25_000_000,
} as const;

export interface WordErrors {
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
  wer: number;
}

export interface CharErrors {
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceChars: number;
  cer: number;
}

interface AlignmentCounts {
  substitutions: number;
  deletions: number;
  insertions: number;
}

export function normalizeForScoring(text: string): string {
  // 1. Unicode NFC
  let s = text.normalize("NFC");

  // Normalize curly single quotes / apostrophes to straight quote '
  s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'");

  // 2. Remove bracketed cues: […] and (…)
  s = s.replace(/\[[^\]]*\]/g, "");
  s = s.replace(/\([^)]*\)/g, "");

  // 3. Remove speaker labels: an all-caps name of 1–4 words followed by :.
  // Appear at start of line or run-on mid-line right after ., !, ?, ], or quotes.
  const speakerRegex = /(?:^|[\r\n]+|(?<=[\.!\?\]"”’'—–-]))\s*((?:[A-Z]+(?:['\-][A-Z]+)*|[A-Z]\.)(?:\s+(?:[A-Z]+(?:['\-][A-Z]+)*|[A-Z]\.)){0,3}):\s*/g;
  let prev: string;
  do {
    prev = s;
    s = s.replace(speakerRegex, " ");
  } while (s !== prev);

  // 4. Re-join split contractions: I 'm → I'm, you 're → you're
  s = s.replace(/\b([A-Za-z]+)\s+(['’])\s*([A-Za-z]+)\b/g, "$1'$3");

  // 5. Lower-case (Latin only)
  s = s.toLowerCase();

  // 6. Turn --, —, –, and - into spaces
  s = s.replace(/--|—|–|-/g, " ");

  // 7. Delete all other punctuation, including Devanagari । and ॥, keeping ' inside words, digits, and %
  s = s.replace(/[।॥]/g, " ");
  s = s.replace(/[^\p{L}\p{M}\p{N}\s%']/gu, " ");
  s = s.replace(/(?<![\p{L}\p{M}\p{N}])'|'(?![\p{L}\p{M}\p{N}])/gu, " ");

  // 8. Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

function alignTokensDP(r: readonly string[], h: readonly string[]): AlignmentCounts {
  const n = r.length;
  const m = h.length;
  const dp = new Int32Array((n + 1) * (m + 1));

  for (let i = 0; i <= n; i++) dp[i * (m + 1)] = i;
  for (let j = 0; j <= m; j++) dp[j] = j;

  for (let i = 1; i <= n; i++) {
    const ri = r[i - 1];
    const row = i * (m + 1);
    const prevRow = (i - 1) * (m + 1);
    for (let j = 1; j <= m; j++) {
      const cost = ri === h[j - 1] ? 0 : 1;
      const sub = dp[prevRow + (j - 1)] + cost;
      const del = dp[prevRow + j] + 1;
      const ins = dp[row + (j - 1)] + 1;
      dp[row + j] = Math.min(sub, del, ins);
    }
  }

  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;

  while (i > 0 || j > 0) {
    const row = i * (m + 1);
    const prevRow = (i - 1) * (m + 1);
    if (i > 0 && j > 0) {
      const match = r[i - 1] === h[j - 1];
      const cost = match ? 0 : 1;
      if (dp[row + j] === dp[prevRow + (j - 1)] + cost) {
        if (!match) substitutions++;
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[row + j] === dp[prevRow + j] + 1) {
      deletions++;
      i--;
      continue;
    }
    if (j > 0 && dp[row + j] === dp[row + (j - 1)] + 1) {
      insertions++;
      j--;
      continue;
    }
  }

  return { substitutions, deletions, insertions };
}

function scoreHirschberg(r: readonly string[], h: readonly string[]): Int32Array {
  let prev = new Int32Array(h.length + 1);
  for (let j = 0; j <= h.length; j++) prev[j] = j;
  for (let i = 1; i <= r.length; i++) {
    const curr = new Int32Array(h.length + 1);
    curr[0] = i;
    const ri = r[i - 1];
    for (let j = 1; j <= h.length; j++) {
      const cost = ri === h[j - 1] ? 0 : 1;
      const sub = prev[j - 1] + cost;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      curr[j] = Math.min(sub, del, ins);
    }
    prev = curr;
  }
  return prev;
}

function alignTokensHirschberg(r: readonly string[], h: readonly string[]): AlignmentCounts {
  if (r.length === 0) {
    return { substitutions: 0, deletions: 0, insertions: h.length };
  }
  if (h.length === 0) {
    return { substitutions: 0, deletions: r.length, insertions: 0 };
  }
  if (r.length === 1) {
    const idx = h.indexOf(r[0]);
    if (idx !== -1) {
      return { substitutions: 0, deletions: 0, insertions: h.length - 1 };
    }
    return { substitutions: 1, deletions: 0, insertions: h.length - 1 };
  }

  const mid = Math.floor(r.length / 2);
  const rLeft = r.slice(0, mid);
  const rRight = r.slice(mid);

  const scoreLeft = scoreHirschberg(rLeft, h);
  const rRightRev = rRight.slice().reverse();
  const hRev = h.slice().reverse();
  const scoreRight = scoreHirschberg(rRightRev, hRev);

  let minCost = Infinity;
  let splitH = 0;
  const hLen = h.length;
  for (let j = 0; j <= hLen; j++) {
    const cost = scoreLeft[j] + scoreRight[hLen - j];
    if (cost < minCost) {
      minCost = cost;
      splitH = j;
    }
  }

  const leftRes = alignTokensHirschberg(rLeft, h.slice(0, splitH));
  const rightRes = alignTokensHirschberg(rRight, h.slice(splitH));
  return {
    substitutions: leftRes.substitutions + rightRes.substitutions,
    deletions: leftRes.deletions + rightRes.deletions,
    insertions: leftRes.insertions + rightRes.insertions,
  };
}

export function alignTokens(r: readonly string[], h: readonly string[]): AlignmentCounts {
  const elements = (r.length + 1) * (h.length + 1);
  if (elements <= SCORING_CONSTANTS.maxFullMatrixElements) {
    return alignTokensDP(r, h);
  }
  return alignTokensHirschberg(r, h);
}

export function wordErrors(reference: string, hypothesis: string): WordErrors {
  const normRef = normalizeForScoring(reference);
  const normHyp = normalizeForScoring(hypothesis);
  const r = normRef.length === 0 ? [] : normRef.split(" ");
  const h = normHyp.length === 0 ? [] : normHyp.split(" ");
  const { substitutions, deletions, insertions } = alignTokens(r, h);
  const referenceWords = r.length;
  const wer = referenceWords === 0
    ? (insertions === 0 ? 0 : 1)
    : (substitutions + deletions + insertions) / referenceWords;
  return { substitutions, deletions, insertions, referenceWords, wer };
}

export function charErrors(reference: string, hypothesis: string): CharErrors {
  const normRef = normalizeForScoring(reference);
  const normHyp = normalizeForScoring(hypothesis);
  const r = Array.from(normRef.replace(/\s+/g, ""));
  const h = Array.from(normHyp.replace(/\s+/g, ""));
  const { substitutions, deletions, insertions } = alignTokens(r, h);
  const referenceChars = r.length;
  const cer = referenceChars === 0
    ? (insertions === 0 ? 0 : 1)
    : (substitutions + deletions + insertions) / referenceChars;
  return { substitutions, deletions, insertions, referenceChars, cer };
}
