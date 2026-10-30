# OffCut ASR Benchmark Architecture & Methodology (v2.0)

## Overview
The OffCut Speech-to-Text benchmark measures speech recognition accuracy (WER, CER, Deletion Rate), real-time factor (RTF), timestamp continuity, and script fidelity across English, Hindi, and code-switched Hinglish audio.

- **Benchmark Schema Version:** `2.0.0`
- **Scoring Methodology Version:** `2.0.0`
- **Benchmark UI Entry:** `http://127.0.0.1:5180/bench/index.html` (served via `npm --prefix engine run dev`)

---

## Output Profiles & Intended Script Contracts

The benchmark defines distinct, typed scoring profiles based on the user-facing contract of each mode:

| Output Profile | Expected Script | Primary Language Mode | Description |
|---|---|---|---|
| `english_latin` | Latin (`Latn`) | `en` | Standard English speech evaluated against human reference. Lowercased, stripped of bracketed cues and non-essential punctuation. |
| `hindi_devanagari` | Devanagari (`Deva`) | `hi` | Spoken Hindi evaluated in Devanagari. Strips Purna Viram (`।`) and Deergh Viram (`॥`), normalizes ZWJ/ZWNJ, and preserves English technical loanwords and percentages. |
| `hinglish_roman` | Romanized Latin (`Latn`) | `hinglish` | Bilingual code-switched speech evaluated against manually verified Romanized ground truth. Strictly penalizes Devanagari output against Romanized expectations. |
| `mixed_diagnostic` | Devanagari + Latin | `auto` (Hinglish audio) | Diagnostic cross-script scoring evaluating mixed Hindi (Devanagari) and English (Latin) vocabulary. |
| `raw_diagnostic` | Any | Diagnostic | NFC normalization and whitespace collapse only. |

---

## Language Queue Construction

The benchmark harness (`engine/bench/main.ts`) explicitly evaluates both forced production modes and diagnostic modes:

### 1. Short Evaluation Set (`set=short`)
- **01_english_podcast:**
  - `language: "en"` (Profile: `english_latin`, Reference: `01_english_podcast/transcripts/reference.txt`)
- **02_hindi:**
  - `language: "hi"` (Primary Hindi production score against `hindi_devanagari` reference)
  - `language: "auto"` (Diagnostic auto-detection score against `hindi_devanagari` reference)
- **03_hinglish:**
  - `language: "hinglish"` (Primary Hinglish production score against `hinglish_roman` reference)
  - `language: "auto"` (Diagnostic auto-detection score against `mixed_diagnostic` reference)
  - `language: "hi"` (Diagnostic forced-Hindi score against `hindi_devanagari` reference)
- **04_noisy_vlog:**
  - `language: "en"` (Profile: `english_latin`)

### 2. Long Evaluation Set (`set=long`)
- `EN_PODCAST_FULL` (1,704s): `language: "en"`
- `MANUAL_ENGLISH_10M` (600s): `language: "en"`
- `STITCH_HINGLISH` (66.6s stitched CoSHE audio):
  - `language: "hinglish"` (Primary stitched Hinglish against `STITCH_HINGLISH_roman_reference.txt`)
  - `language: "auto"` (Diagnostic stitched auto against `STITCH_HINGLISH_reference.txt`)
- `STITCH_SILENCE` (23.3s silence + speech + silence): `language: "en"`

---

## Reference Selection Logic (`selectReferenceForSample`)

Reference selection is explicit and verified:
1. When evaluating `mode: "hinglish"`, the selector resolves the Romanized Hinglish reference (`*_roman_reference.txt`). If a Romanized reference is missing, it falls back to a diagnostic unverified reference and flags `verified: false`.
2. When evaluating `mode: "hi"`, the selector resolves the Devanagari reference (`*_reference.txt`).
3. When evaluating `mode: "en"`, the selector resolves the Latin English reference.
4. Auto runs (`mode: "auto"`) resolve language-appropriate references without contaminating forced-language production aggregates.
5. The scorer **never** uses the production transliteration function (`transliterateDevanagariToHinglish()`) to convert reference text; ground truth is established independently.

---

## OffCut Romanization Standard v1

For `hinglish_roman` references, speech is transcribed following this consistent orthographic standard:
- **Pronouns:** `main`, `hum`, `tu`, `tum`, `aap`, `yeh` / `ye`, `woh` / `wo`, `mera`, `meri`, `mere`, `apna`, `apne`, `apni`, `jiska`, `isko`, `inko`, `unko`.
- **Verbs:** `karna`, `karte`, `karne`, `raha`, `rahe`, `rahi`, `hona`, `hote`, `hota`, `hote`, `hai`, `hain`, `tha`, `the`, `thi`, `gaya`, `gaye`, `gayi`, `lena`, `leta`, `jao`, `aate`, `aati`.
- **Postpositions & Particles:** `ka`, `ke`, `ki`, `ko`, `se`, `mein`, `par`, `toh`, `na`, `bhi`, `kya`, `kyun`, `phir`, `lekin`, `aur`.
- **English Loanwords:** Retained in standard English orthography (`propaganda`, `believe`, `supply`, `power`, `married`, `effort`, `genuine`, `cases`, `problem`, `mental make up`, `circumstances`, `incidences`, `normal`, `household words`, `by default`, `weak`, `feeding`, `toxicity`).
- **Numerals:** Spelled phonetically as spoken (`dus`, `chaubees`).
- **Contractions:** Standard English apostrophe conventions (`dont`, `don't`, `can't`).

---

## Metrics & Aggregation

### 1. Word Error Rate (WER)
\[
\text{WER} = \frac{S + D + I}{N}
\]
Where $S$ is substitutions, $D$ is deletions, $I$ is insertions, and $N$ is the number of reference words. WER is unconstrained and can legitimately exceed 100% when $I > N$.

### 2. Character / Grapheme Error Rate (CER)
Evaluated across normalized characters without spaces. In environments supporting `Intl.Segmenter`, grapheme cluster CER is computed to account for Indic multi-codepoint conjuncts and matras.

### 3. Micro vs Macro Metrics
- **Macro WER:** Arithmetic mean of sample WERs:
  \[
  \text{Macro WER} = \frac{1}{K} \sum_{i=1}^K \text{WER}_i
  \]
- **Micro WER (Corpus WER):** Total edit operations divided by total reference words:
  \[
  \text{Micro WER} = \frac{\sum_{i=1}^K (S_i + D_i + I_i)}{\sum_{i=1}^K N_i}
  \]
Both metrics are reported in mode-specific summary tables.

### 4. Output Script Diagnostics
Hypothesis strings are analyzed for script distribution:
- `devanagariChars`: count of `[\u0900-\u097F]`
- `latinChars`: count of `[a-zA-Z]`
- `persoArabicChars`: count of Arabic/Urdu characters
- `replacementChars`: count of `\uFFFD`
- `suspiciousMarks`: count of dangling or unattached matras
- `expectedScriptMatchRate`: ratio of characters matching the expected profile script

---

## Running the Benchmark

Start the engine development server:
```powershell
npm --prefix engine run dev
```

Navigate in Chrome or Edge:
```
http://127.0.0.1:5180/bench/index.html?model=tiny&device=wasm&vad=on&set=short&runs=1&label=phase1-check
```

### URL Query Parameters:
- `model`: `tiny` | `base` (default: `tiny`)
- `device`: `webgpu` | `wasm` (default: auto-detected)
- `vad`: `on` | `off` (default: `off`)
- `retry`: `on` | `off` (default: `on`)
- `recovery`: `none` | `legacy_bisect` | `ladder` (default: `ladder`)
- `windowPolicy`: `baseline` | `fixed_duration` | `largest_pause` | `adaptive_pause` (default: `baseline`)
- `maxWindow`: window upper bound in seconds (e.g. `15`, `12`, `10`, `8`, `5`)
- `overlap`: window overlap duration in seconds (e.g. `2`, `1`)
- `splitPause`: minimum pause duration in seconds for natural splitting (e.g. `0.15`)
- `decoding`: `baseline` | `repetition_penalty` | `temperature` | `no_repeat_ngram` | `combined`
- `repPenalty`: repetition penalty multiplier (e.g. `1.15`)
- `noRepeatNgram`: n-gram size for repetition blocking (e.g. `3`)
- `temp`: sampling temperature value (e.g. `0.3`)
- `doSample`: `true` | `false`
- `conditioning`: `legacy` | `none` | `filter_only` | `norm_only` (default: `legacy`)
- `diagnostics`: `on` | `off` (default: `on`)
- `sample`: filter by sample id (e.g. `HINGLISH_COSHE_002`, `HI_INDIC_001`, `EN_PODCAST_001`, `all`)
- `set`: `short` | `long` | `all` (default: `short`)
- `runs`: integer repeat count (default: `1`)
- `label`: run identifier prefix for results JSON

Results are automatically saved to `asr-evaluation-assets/results/<label>-<model>-<timestamp>.json` and appended to `engine/bench/RESULTS.md`.
