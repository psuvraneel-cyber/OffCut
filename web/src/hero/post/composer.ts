import * as THREE from 'three'
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  type Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing'
import type { GpuTier } from '../engine/quality'

// Film-grade finish for the WebGL canvas only (the hero text is DOM, so it stays crisp).
// The scene renders into a half-float buffer so additive particles can go past 1.0; bloom then
// picks out only what's genuinely bright (dense clusters, fast hot particles), ACES tone maps it
// back into range, and grain, vignette and chromatic aberration add the lens. ACES rather than AgX:
// AgX greys out violets, while ACES keeps them saturated (palette colours are pre-inverted through
// it, see tone.ts).
export class PostChain {
  private readonly composer: EffectComposer

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, tier: GpuTier, reducedMotion: boolean) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(scene, camera))

    // Everything runs in one full-screen pass after the scene (chromatic aberration is the only
    // convolution effect, so it can share it); a separate pass cost ~0.8 ms at 1900×1200 on an iGPU.
    const effects: Effect[] = []
    // Tiny colour fringing that grows towards the edges, like a real lens. High tier only.
    if (tier.chromaticAberration) {
      effects.push(
        new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0011, 0.0007), radialModulation: true, modulationOffset: 0.3 }),
      )
    }
    if (tier.bloom !== 'none') {
      const bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.42,
        luminanceSmoothing: 0.4,
        intensity: 1.5,
        radius: 0.72,
      })
      // Mipmap bloom starts from the luminance pass, so its size sets the bloom resolution.
      bloom.luminancePass.resolution.scale = tier.bloom === 'half' ? 0.5 : 0.25
      effects.push(bloom)
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }))
    if (tier.vignette) effects.push(new VignetteEffect({ offset: 0.28, darkness: 0.55 }))
    // Animated grain would flicker, so reduced motion goes without.
    if (tier.grain && !reducedMotion) {
      const grain = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: false })
      grain.blendMode.opacity.value = 0.22
      effects.push(grain)
    }
    this.composer.addPass(new EffectPass(camera, ...effects))
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height, false)
  }

  render(dt: number) {
    this.composer.render(dt)
  }

  dispose() {
    this.composer.dispose()
  }
}
