# Brief: Phase 2 P2.1 — IndicConformer full-corpus validation and browser proof (revised)

_Revised 2026-10-30. This replaces the P2.1 section ("PART 11") of the ChatGPT handoff. Read the rest of that handoff, `HANDOFF.md`, and `D:\OffCut-Evaluation\reports\PHASE_2_P2_0_MODEL_FEASIBILITY_REPORT.md` for background._

## Why this brief was revised

A check of the P2.0 artifacts on 2026-10-30 found five things the original P2.1 brief didn't cover:

1. **The browser has never transcribed real speech.** `engine/bench/test-conformer.ts` (lines 46–49) feeds the model a `[1, 80, 200]` tensor of random numbers. The browser load time, speed and memory figures are for 2 seconds of noise. They show the graph *runs*, not that it *transcribes*.
2. **The 3.57% Hindi WER came from Python.** `D:\OffCut-Evaluation\p2-model-poc\run_poc_evaluation.py` uses `librosa` and `onnxruntime` for Python. Its feature extraction (lines ~209–219) has never been reproduced in TypeScript.
3. **The Romanized Hinglish references are machine-made and unreviewed.** `manifests/hinglish_roman_reference_review.csv` has `review_status: NOT_REVIEWED` and `reviewer_id: UNASSIGNED` on all 50 rows. Its spellings come from an academic transliteration scheme, not natural Hinglish (`dayem`, `karem`, `haim`, `karyashalae.n`). Any Romanized WER scored against them, including P2.0's 85.80%, is unreliable.
4. **The English numbers contradict each other, and the English test is a single clip.** Whisper `base` scored 4.66% earlier and 30.51% in P1.1. Whisper `tiny` on `EN_PODCAST_001` scored 12.29% alone but 32.63% in the full short-set run `Phase2_P0_1_1_FullEval_fixed_ladder` (`engine/bench/RESULTS.md`). Neither gap is explained.
5. **The repo state in the handoff is out of date.** HEAD is `c616bf8` (all P0.1–P2.0 work is committed), not `19253ea` with "zero commits".

## Verified starting facts

- `D:\OffCut-Evaluation\p2-model-poc\model.onnx`: 493,060,285 bytes, SHA256 `fb362cae38fd183546d92a614bab2dcb6098702d53efb8e2f6fe850cda43e0d1` (matches P2.0; checked 2026-10-30). `D:` is a `subst` of `C:\`, so this is the same as `C:\OffCut-Evaluation\`.
- All 100 references are `SOURCE_PROVIDED_UNVERIFIED` (`reports/REFERENCE_VERIFICATION_REPORT.md`). Common Voice clips come from the CV **test** split; Kathbath clips from the Kathbath **valid** split.
- The P2.0 reference feature pipeline (`run_poc_evaluation.py`):
  - 16 kHz mono; pre-emphasis 0.97, keeping the first sample as is.
  - `librosa.feature.melspectrogram`: `n_fft=512`, `hop_length=160`, `win_length=400`, `n_mels=80`, `fmin=0`, `fmax=8000`, `norm="slaney"`, `power=2.0`, with librosa defaults for everything else (`center=True`, Hann window, `htk=False`, `pad_mode="constant"`).
  - `log(mel + 2^-24)`.
  - Per-mel-bin normalisation over time: mean, and std with `ddof=1`, plus `1e-5`.
  - Input names `audio_signal` `[1, 80, T]` float32 and `length` `[1]` int64 = `T`.
  - Greedy CTC: argmax, collapse repeats, drop the blank, map ids through `vocab.json`, replace `▁` with a space.
  - RTF in P2.0 counts inference only, not feature extraction.

## Rules

- Do not modify production transcription code (`engine/src/`, `web/src/`), and do not integrate IndicConformer into the production worker.
- Do not rewrite transliteration, fine-tune the model, or overwrite existing reports or references.
- Do not commit or push. Preserve all existing changes in the working tree.
- Do not add COOP/COEP headers or anything that needs `SharedArrayBuffer`. Single-threaded WASM only.
- Never describe Python results as browser results. Label every number with where it ran: `python-ort`, `browser-wasm` or `browser-webgpu`.
- Never mark a reference `HUMAN_VERIFIED` yourself. Only the owner can do that.

All outputs go in `D:\OffCut-Evaluation\p2-model-poc\p2_1\`. Browser test code may go under `engine/bench/` (dev-only, like `test-conformer.ts`).

## Tasks, in order

### A. Reproduce P2.0 (gate)

Re-run `run_poc_evaluation.py` unchanged on the same 20-sample subset. It must reproduce the reported numbers (Hindi 3.57%, Hinglish mixed 61.39%, script-normalised 58.86%) to the second decimal. If it doesn't, stop and report the difference before doing anything else.

### B. Full corpus in Python

Run the same pipeline on all 100 clips (25 Common Voice, 25 Kathbath, 50 MUCS).

- **Hindi:** report micro and macro WER, CER, S/D/I, exact-match rate and RTF, per dataset and combined.
- **Hinglish:** score `hinglish_mixed_verbatim`, `hinglish_script_normalized` and `raw_diagnostic`. Score `hinglish_roman` too, but label it **"unreliable: references unreviewed"** wherever it appears (see task E).
- Save every raw hypothesis next to its reference. Every aggregate must be recomputable from `sample_level_metrics.csv`.

### C. Browser end-to-end proof

This is the core new work: one real audio clip in, text out, entirely in the browser, with no Python features.

1. Write a TypeScript feature extractor matching the Python pipeline above. Start from 16 kHz Float32 audio, apply pre-emphasis, centre-pad, take a Hann-window STFT, apply a Slaney mel filterbank, take the log, and normalise per bin.
2. **Feature parity check:** for at least 5 clips (mixing Common Voice, Kathbath and MUCS), export the Python `norm_mel` arrays and compare them with the browser arrays. Report max absolute difference, mean absolute difference and frame count. Agree a tolerance first (suggested: max abs diff ≤ 1e-3 after normalisation, identical `T`). If the features don't match, fix the extractor before going on.
3. **Text parity check:** run all 50 Hindi clips through the browser pipeline (ONNX Runtime Web, single-threaded WASM) and compare the text with the Python hypotheses. Report how many are identical, and the WER of browser output against Python output. Any non-identical clip needs a cause.
4. **Real runtime:** using real clips, not noise, measure model load time (cold and warm cache), feature extraction time, inference time, median and p90 RTF including feature extraction, peak and post-disposal memory, and stability over at least 50 consecutive clips. Document how memory was measured.
5. Also run WebGPU on the same clips and report it, but keep WASM as the default unless WebGPU is clearly faster on real input.

### D. Held-out owner clips

The test-set clips may be in the model's training data (see task F). The owner will provide 10–20 short clips of their own (Hindi and Hinglish, Instagram-style speech) in `D:\OffCut-Evaluation\raw\owner_holdout\`, each with a reference transcript the owner writes or approves.

- If the folder exists, standardise the clips like the rest of the corpus, run them through **both** the Python and browser pipelines, and report them as a separate category, `05_owner_holdout`.
- If the folder doesn't exist, skip this part and list it as **blocked: waiting for owner clips** in the report. Do not substitute other clips.

### E. Reference quality

1. Build `human_review_queue.csv`, ranked by priority:
   - clips where model and reference disagree a lot;
   - clips where the reference looks wrong (truncation, odd tokens, digits against words);
   - all 50 Romanized Hinglish references.
2. Write a short **Romanization style guide** for natural Hinglish (the existing "OffCut Romanization Standard v1" in `engine/bench/README.md` is a starting point): `karein` not `karem`, `hain` not `haim`, no `.n` nasal markers, and English words in normal English spelling.
3. For every Romanized reference, propose a **natural-style rewrite** in a new column. Leave the existing references untouched; mark the proposals `PROPOSED_UNREVIEWED`.
4. Do not rescore anything against the proposals. They become references only after the owner reviews them.

### F. Training-data overlap

Find out what IndicConformer Hindi was trained and validated on: the model card, the AI4Bharat papers, and the NeMo config inside the `.nemo` file if available. Classify each dataset as **confirmed overlap**, **potential overlap**, **no known overlap** or **unknown**, with sources. Expect Kathbath (an AI4Bharat dataset; our clips are from its valid split) to be the highest risk. Say plainly how much the Hindi WER can be trusted given the result.

### G. English loanword lexicon test

The model hears English words but writes them in Devanagari (`अकाउंट्स` for accounts, `क्रिएट` for create, `फॉर्मेट` for format, `ट्यूटोरियल` for tutorial). Test whether a lookup can restore them. This is an experiment in `p2_1/`, not production code.

1. Build a lexicon mapping the Devanagari spellings of common English words to their English spelling. Build it from an English word list run through a Roman→Devanagari transliterator, plus the English words that appear in the MUCS references. **Hold out at least 20 of the 50 MUCS clips** and build the lexicon without their references, so the result isn't fitted to the test.
2. Apply it to IndicConformer's Hinglish output: replace a Devanagari word with the English word only on an exact or near-exact lexicon match, and leave everything else alone.
3. Report, on the held-out clips:
   - English-word recall: the share of English words in the reference that come out spelled correctly in Latin script;
   - false conversions: Hindi words wrongly turned into English;
   - mixed-verbatim WER before and after.
4. Give an honest verdict: is this worth building, or is a different model needed for Hinglish?

### H. English regression

1. **Explain the two contradictions** in "Why this brief was revised", item 4: `tiny` at 12.29% alone against 32.63% in the full run, and `base` at 4.66% against 30.51%. Compare configs (device, dtype, VAD, window policy, recovery, `maxWindow`, sample order, warm or cold model) and re-run until the cause is found or ruled out.
2. Re-run English on more than one clip: at least `EN_PODCAST_001`, `MANUAL_ENGLISH_10M`, `EN_PODCAST_FULL` and the `04_noisy_vlog` clips from `asr-evaluation-assets/`, for both `tiny` and `base`.
3. State plainly that this is still a small English set.

### I. Acceptance gates

Report a pass or fail for each gate, with the evidence behind it:

| Gate | Threshold |
|---|---|
| Python reproduces P2.0 | Exact to 2 decimals |
| Hindi micro WER, all 50 clips (python-ort) | ≤ 15% |
| Each Hindi dataset | ≤ 20% micro WER |
| Browser features match Python | Agreed tolerance on ≥ 5 clips |
| Browser text matches Python | ≥ 48 of 50 Hindi clips identical, every difference explained |
| Browser runtime on real audio | RTF ≤ 1.0 including features; no crash or OOM across 50 clips |
| Owner held-out Hindi clips | ≤ 20% WER, or "blocked" if no clips |
| Training overlap | Disclosed, with sources |
| English | Both contradictions explained |

Hinglish has no pass/fail gate in P2.1: its references aren't reviewed yet. Report the numbers and the lexicon verdict instead.

## Deliverables (in `p2_1/`)

1. `PHASE_2_P2_1_FULL_CORPUS_VALIDATION_REPORT.md`, written in plain language, with a gate table at the top
2. `hindi_full_results.json`, `hinglish_full_results.json`
3. `sample_level_metrics.csv`, with a `runtime` column (`python-ort`, `browser-wasm`, `browser-webgpu`)
4. `feature_parity_results.json`, `browser_text_parity_results.json`
5. `runtime_resource_results.json` (real audio only)
6. `dataset_overlap_audit.json`
7. `reference_quality_audit.json`, `human_review_queue.csv`, `hinglish_roman_style_guide.md`, `hinglish_roman_proposals.csv`
8. `lexicon_experiment_results.json`, plus the lexicon file and the held-out split
9. `english_regression_results.json`, including the contradiction analysis
10. `model_failure_analysis.json`
11. `benchmark_reproduction.md`: exact commands to reproduce every number
12. `p2_1_manifest.json`: checksums of the model, vocab, every script and every output

Then add a P2.1 section to `HANDOFF.md` after the P2.0 section: what passed, what failed, what's blocked, and what's next. Don't rewrite earlier sections. Update the "Last updated" line and "What's next".

## What happens after P2.1

- **All Hindi gates pass,** including browser parity: P2.2 becomes production integration of IndicConformer for Hindi (model adapter, download progress, caching, disposal), with Hindi labelled as beta.
- **Python passes but browser parity fails:** fix the browser pipeline before anything else.
- **Held-out clips fail while test-set clips pass:** treat the 3.57% as contamination-inflated, and look again for a Hindi model.
- **Hinglish:** the lexicon result, plus the owner's review of the Romanized references, decides whether P2.3 builds the lexicon or looks for a code-switching model.
