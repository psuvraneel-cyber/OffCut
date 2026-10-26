export type ResourceClass = "gpu" | "cpu" | "io";
export type Device = "webgpu" | "wasm";

export interface StageContext {
  signal: AbortSignal;
  device: Device;
  reportProgress(fraction: number, detail?: string): void;
}

export interface Stage<In = unknown, Out = unknown> {
  readonly name: string;
  readonly resource: ResourceClass;
  readonly weight?: number;
  readonly supportsWasmFallback?: boolean;
  run(input: In, context: StageContext): Promise<Out>;
  release(): Promise<void>;
  terminate?(): void;
}

export interface JobProgress {
  fraction: number;
  stage: string;
  stageIndex: number;
  stageCount: number;
  stageFraction: number;
  detail?: string;
}

export type RuntimeEvent =
  | { type: "lock-wait"; stage: string; at: number }
  | { type: "stage-start"; stage: string; device: Device; at: number; memoryBytes?: number }
  | { type: "stage-end"; stage: string; at: number; durationMs: number; memoryBytes?: number }
  | { type: "stage-error"; stage: string; at: number; durationMs: number; errorName: string; message: string }
  | { type: "gpu-lost"; stage: string; at: number; willRetryOnWasm: boolean }
  | { type: "release-error"; stage: string; at: number; message: string }
  | { type: "terminated"; stage: string; at: number; reason: "cancel-timeout" | "release-timeout" }
  | { type: "cancelled"; at: number }
  | { type: "tab-hidden"; at: number };

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { mode: "exclusive"; signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export interface GpuLock {
  run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export interface VisibilitySource {
  isHidden(): boolean;
  subscribe(onChange: () => void): () => void;
}

export interface RuntimeOptions {
  gpuLock?: GpuLock;
  gpuAvailable?: boolean;
  now?: () => number;
  memoryBytes?: () => number | undefined;
  visibility?: VisibilitySource;
  onEvent?: (event: RuntimeEvent) => void;
  cancelGraceMs?: number;
  releaseTimeoutMs?: number;
}

export interface Runtime {
  runJob<Out>(
    stages: readonly Stage<any, any>[],
    input: unknown,
    options?: { signal?: AbortSignal; onProgress?: (progress: JobProgress) => void },
  ): Promise<Out>;
  health(): { webgpu: "ok" | "unhealthy" | "unavailable" };
}
