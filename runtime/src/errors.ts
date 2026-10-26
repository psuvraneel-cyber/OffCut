export class RuntimeAbortError extends Error {
  constructor(message = "The runtime job was cancelled.") {
    super(message);
    this.name = "AbortError";
  }
}

export function isGpuLostError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "GpuLostError";
}
