export class UnsupportedFormatError extends Error {
  constructor(message = "This media format is not supported by this browser.") {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

export class NoAudioTrackError extends Error {
  constructor(message = "This file does not contain an audio track.") {
    super(message);
    this.name = "NoAudioTrackError";
  }
}

export class ModelLoadError extends Error {
  constructor(message = "The speech model could not be loaded. Check your connection and try again.") {
    super(message);
    this.name = "ModelLoadError";
  }
}

export class OutOfMemoryError extends Error {
  constructor(message = "This file is too large for the browser fallback decoder. Try a smaller file or a supported format.") {
    super(message);
    this.name = "OutOfMemoryError";
  }
}

export class AbortError extends Error {
  constructor(message = "Transcription was cancelled.") {
    super(message);
    this.name = "AbortError";
  }
}

export class GpuLostError extends Error {
  constructor(message = "The graphics processor stopped responding. Try again; the next run uses the CPU.") {
    super(message);
    this.name = "GpuLostError";
  }
}

export function toEngineError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : "The transcription failed.");
}
