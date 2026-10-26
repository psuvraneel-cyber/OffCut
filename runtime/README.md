# Offcut runtime

The runtime runs a job's stages in order and allows only one GPU-heavy stage at a time. The GPU lock can use Web Locks, so separate tabs on the same origin also take turns. CPU and I/O stages do not use the lock.

Every stage is released after it runs, including after errors and cancellation. A cancellation gives a stage a grace period before `terminate()` is called; a release that exceeds its timeout is also terminated. A lost WebGPU device makes the runtime unhealthy and a stage that opts in is retried once on WASM. Events are local callbacks only and are never sent anywhere.

## Stages

A stage owns its worker and resources:

```ts
const stage: Stage<Input, Output> = {
  name: "transcribe",
  resource: "gpu",
  supportsWasmFallback: true,
  async run(input, context) {
    return workerRequest(input, context.signal, context.reportProgress);
  },
  async release() {
    await workerClosedown();
  },
  terminate() {
    worker.terminate();
  },
};
```

## M1 scope

M1 contains the runtime core and fake-step tests. Real transcription, video stages, the stress test, parallel GPU steps, memory budgets and resumable jobs are later milestones.
