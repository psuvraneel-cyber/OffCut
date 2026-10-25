import * as THREE from 'three'
import { WIDE_LAYOUT_MIN } from './engine/layout'
import type { ShapeSet } from './particles/shapes'
import { fragmentShader, vertexShader } from './liteShaders'

// Mirrors the CSS tokens, lightened a touch so the particles glow on the night background.
const PALETTE = { a: '#9b7bff', b: '#e08bff', c: '#6fe3ff' }
const CAMERA_Z = 6
const FOV = 35

interface Options {
  getIntro: () => number
  getScroll: () => number
  // Narrow layout only: pixels from the top of the canvas where the hero text begins.
  getTextTop: () => number
  reducedMotion: boolean
}

// Hex → linear 0..1 RGB without Three's colour management, because the shader writes colours as-is.
function rgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16)
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

function createUniforms(pixelRatio: number, reducedMotion: boolean) {
  return {
    uTime: { value: 0 },
    uIntro: { value: 0 },
    uScroll: { value: 0 },
    uSize: { value: window.innerWidth < WIDE_LAYOUT_MIN ? 22 : 28 },
    uPixelRatio: { value: pixelRatio },
    uMotion: { value: reducedMotion ? 0 : 1 },
    uMouse: { value: new THREE.Vector3(99, 99, 0) },
    uMouseStrength: { value: 0 },
    uMouseRadius: { value: 0.45 },
    uColorA: { value: rgb(PALETTE.a) },
    uColorB: { value: rgb(PALETTE.b) },
    uColorC: { value: rgb(PALETTE.c) },
  }
}

// The v1 hero, kept as the fallback for GPUs without float render targets (see engine/quality.ts).
// Owns the WebGL scene for the hero: renders only while the canvas is on screen.
export class LiteParticleField {
  private readonly canvas: HTMLCanvasElement
  private readonly options: Options
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50)
  private readonly group = new THREE.Group()
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.ShaderMaterial
  private readonly uniforms: ReturnType<typeof createUniforms>
  private readonly resizeObserver: ResizeObserver
  private readonly visibilityObserver: IntersectionObserver
  private readonly pointer = { x: 0, y: 0 }
  private readonly tilt = { x: 0, y: 0 }
  // Cursor → particle-space mapping: a ray from the camera through the cursor, hitting the shape's plane.
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2()
  private readonly shapePlane = new THREE.Plane()
  private readonly planeNormal = new THREE.Vector3()
  private readonly hit = new THREE.Vector3()
  private pointerInside = false
  private frameId = 0
  private running = false
  private onScreen = false
  private paused = false

  constructor(canvas: HTMLCanvasElement, shapes: ShapeSet, options: Options) {
    this.canvas = canvas
    this.options = options

    // Throws when WebGL is unavailable; the caller falls back to the static gradient.
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setClearColor(0x000000, 0)

    const attribute = (array: Float32Array, size: number) => new THREE.BufferAttribute(array, size)
    this.geometry.setAttribute('position', attribute(shapes.frame, 3))
    this.geometry.setAttribute('aCloud', attribute(shapes.cloud, 3))
    this.geometry.setAttribute('aFrame', attribute(shapes.frame, 3))
    this.geometry.setAttribute('aPhone', attribute(shapes.phone, 3))
    this.geometry.setAttribute('aCaptions', attribute(shapes.captions, 3))
    this.geometry.setAttribute('aLaptop', attribute(shapes.laptop, 3))
    this.geometry.setAttribute('aRandom', attribute(shapes.random, 1))
    this.geometry.setAttribute('aScale', attribute(shapes.scale, 1))

    this.uniforms = createUniforms(this.renderer.getPixelRatio(), options.reducedMotion)
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    const points = new THREE.Points(this.geometry, this.material)
    points.frustumCulled = false // particles move in the shader, so the CPU-side bounds are wrong
    this.group.add(points)
    this.scene.add(this.group)
    this.camera.position.z = CAMERA_Z

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.visibilityObserver = new IntersectionObserver(([entry]) => {
      this.onScreen = entry.isIntersecting
      this.updateRunning()
    })
    this.visibilityObserver.observe(canvas)
    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    window.addEventListener('pointerup', this.onPointerUp, { passive: true })
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave)

    this.resize()
  }

  dispose() {
    this.stop()
    this.resizeObserver.disconnect()
    this.visibilityObserver.disconnect()
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave)
    this.geometry.dispose()
    this.material.dispose()
    this.renderer.dispose()
  }

  // Lets the page stop the hero entirely (e.g. while the clipping tool needs the GPU).
  setPaused(paused: boolean) {
    this.paused = paused
    this.updateRunning()
  }

  private updateRunning() {
    if (this.onScreen && !this.paused) this.start()
    else this.stop()
  }

  private start() {
    if (this.running) return
    this.running = true
    this.frameId = requestAnimationFrame(this.tick)
  }

  private stop() {
    this.running = false
    cancelAnimationFrame(this.frameId)
  }

  private readonly tick = (now: number) => {
    this.render(now)
    this.frameId = requestAnimationFrame(this.tick)
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1
    this.pointer.y = -((event.clientY / window.innerHeight) * 2 - 1)

    const rect = this.canvas.getBoundingClientRect()
    this.pointerInside =
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
    this.pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  }

  // A finger lifting off the screen shouldn't leave a permanent dent in the shape.
  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') this.pointerInside = false
  }

  private readonly onPointerLeave = () => {
    this.pointerInside = false
  }

  private render(now: number) {
    const seconds = now / 1000
    const u = this.uniforms
    const motion = u.uMotion.value
    u.uTime.value = seconds
    u.uIntro.value = this.options.getIntro()
    u.uScroll.value = this.options.getScroll()

    // Ease towards the pointer for a gentle parallax tilt, plus a slow idle sway.
    this.tilt.x += (this.pointer.y * 0.18 - this.tilt.x) * 0.05
    this.tilt.y += (this.pointer.x * 0.3 - this.tilt.y) * 0.05
    this.group.rotation.x = this.tilt.x * motion
    this.group.rotation.y = (this.tilt.y + Math.sin(seconds * 0.25) * 0.12) * motion

    // Fade the cursor's influence in and out, and follow it with a little lag so it feels liquid.
    u.uMouseStrength.value += ((this.pointerInside ? motion : 0) - u.uMouseStrength.value) * 0.08
    if (this.pointerInside) {
      this.group.updateMatrixWorld()
      this.raycaster.setFromCamera(this.pointerNdc, this.camera)
      this.planeNormal.set(0, 0, 1).applyQuaternion(this.group.quaternion)
      this.shapePlane.setFromNormalAndCoplanarPoint(this.planeNormal, this.group.position)
      if (this.raycaster.ray.intersectPlane(this.shapePlane, this.hit)) {
        u.uMouse.value.lerp(this.group.worldToLocal(this.hit), 0.25)
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  private resize() {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!width || !height) return

    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    // Size of the visible area at z = 0, in world units.
    const visibleHeight = 2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const visibleWidth = visibleHeight * this.camera.aspect
    if (width >= WIDE_LAYOUT_MIN) {
      this.group.position.set(visibleWidth * 0.2, 0, 0)
      this.group.scale.setScalar(Math.min(1, (visibleWidth * 0.48) / 2.8))
    } else {
      // Fit the shape (at most ~2.2 units tall) into the gap between the top of the screen and the text.
      const unitsPerPixel = visibleHeight / height
      const top = 72 // px, clears the step counter
      const gap = Math.max(this.options.getTextTop() - top - 24, height * 0.2)
      const centreFromTop = top + gap / 2
      this.group.position.set(0, visibleHeight / 2 - centreFromTop * unitsPerPixel, 0)
      this.group.scale.setScalar(Math.min(0.85, visibleWidth / 3.1, (gap * unitsPerPixel) / 2.2))
    }

    if (!this.running) this.render(performance.now())
  }
}
