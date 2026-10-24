import type * as THREE from 'three'
import type { PointerState } from '../interaction/pointer'
import type { GpuTier } from './quality'

// Everything a hero system may read each frame. The engine owns one instance and updates it in place.
export interface FrameState {
  // Seconds since the engine started.
  time: number
  // 0 → 3 from Hero.tsx's scroll timeline (one unit per step), and 0 → 1 for the intro.
  scroll: number
  intro: number
  // 0 for reduced motion, 1 otherwise.
  motion: number
  tier: GpuTier
  pointer: PointerState
  // The pointer projected onto the shape's plane, in shape units, and how strongly it acts (0..1).
  pointerLocal: THREE.Vector3
  pointerInfluence: number
  camera: THREE.PerspectiveCamera
  // The shape's frame: layout scale and parallax tilt. Particles live in its local space.
  anchor: THREE.Group
  // Canvas size in CSS px, and the renderer's pixel ratio.
  width: number
  height: number
  pixelRatio: number
  // The latest swipe-to-cut and tap shockwave. `id` goes up by one per event (0 = none yet), so each
  // system can react exactly once; `age` is seconds since the event.
  cut: CutEvent
  shock: ShockEvent
}

export interface CutEvent {
  id: number
  age: number
  // The stroke in shape units, and in canvas uv (0..1, +y up) for the fluid.
  start: THREE.Vector2
  end: THREE.Vector2
  startUv: THREE.Vector2
  endUv: THREE.Vector2
}

export interface ShockEvent {
  id: number
  age: number
  centre: THREE.Vector3
  centreUv: THREE.Vector2
}

export interface HeroSystem {
  // Fixed-rate simulation step (1/60 s). Runs 0–2 times per frame, before update().
  step?(dt: number, state: FrameState): void
  // Once per rendered frame, with the real frame time.
  update(dt: number, state: FrameState): void
  resize?(state: FrameState): void
  dispose(): void
}
