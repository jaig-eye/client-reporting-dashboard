'use client'

// The sign-in screens' background: an analytics landscape in three.js. Thousands of points form a
// slowly rolling data surface that rises toward the right (growth), with a glowing trend line
// riding above it and a few chart markers on the line. It follows the pointer a little, and it
// answers the form: a pulse rings out through the surface while signing in, the whole field
// surges on success, and the trend line dims and reddens on an error.
//
// Colours come from the theme (--accent, the agency's brand colour) and are re-read when the
// theme flips. Kept light: fewer points on a phone, the pixel ratio capped, the loop paused while
// the tab is hidden, a single still frame for reduced motion, and nothing at all (the page's own
// gradient shows) where WebGL isn't available. three.js loads only on these screens.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export type LoginCanvasMode = 'idle' | 'busy' | 'success' | 'error'

const SURFACE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform float uSurge;
  uniform float uPixelRatio;
  uniform float uSize;
  attribute float aRand;
  varying float vHeight;
  varying float vFade;
  varying float vRing;

  float surface(vec2 p, float t) {
    return sin(p.x * 0.32 + t * 0.55) * 0.55
         + sin(p.y * 0.41 - t * 0.42) * 0.45
         + sin((p.x + p.y) * 0.21 + t * 0.31) * 0.75
         + sin(length(p - vec2(8.0, -4.0)) * 0.55 - t * 0.8) * 0.22;
  }

  void main() {
    vec3 pos = position;
    float h = surface(pos.xz, uTime);
    // Growth: the field rises toward the right.
    h += (pos.x + 30.0) * 0.045;
    // A ring travelling out from the centre while signing in.
    float d = length(pos.xz - vec2(0.0, 2.0));
    float front = mod(uTime * 11.0, 46.0);
    float ring = exp(-pow(d - front, 2.0) * 0.06) * uPulse;
    h += ring * 1.4 + uSurge * (0.6 + 0.4 * sin(d * 0.5 - uTime * 4.0));
    pos.y += h;
    vHeight = h;
    vRing = ring;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.55 + aRand * 0.7) * (1.0 + ring * 1.6 + uSurge * 0.8) / -mv.z;
    vFade = smoothstep(70.0, 14.0, -mv.z) * smoothstep(-1.0, 6.0, -mv.z);
  }
`

const SURFACE_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uAlpha;
  uniform float uAlert;
  varying float vHeight;
  varying float vFade;
  varying float vRing;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    vec3 col = mix(uColorA, uColorB, clamp(vHeight * 0.18 + 0.25, 0.0, 1.0));
    col = mix(col, uColorB, vRing);
    col = mix(col, vec3(0.92, 0.26, 0.26), uAlert * 0.45);
    gl_FragColor = vec4(col, soft * vFade * uAlpha * (0.8 + vRing * 0.2));
  }
`

const LINE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const LINE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uSpeed;
  uniform float uAlert;
  varying vec2 vUv;
  void main() {
    float head = fract(uTime * uSpeed);
    float glow = exp(-pow((vUv.x - head) * 9.0, 2.0));
    float base = 0.35 + 0.65 * smoothstep(0.0, 0.15, vUv.x);
    float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
    vec3 col = mix(uColor, vec3(1.0), glow * 0.55);
    col = mix(col, vec3(0.92, 0.26, 0.26), uAlert * 0.6);
    gl_FragColor = vec4(col, (base * 0.55 + glow) * edge * uAlpha * (1.0 - uAlert * 0.55));
  }
`

/** The theme's accent and whether the page is dark, read off the document. */
function readTheme(): { accent: THREE.Color; dark: boolean } {
  const root = document.documentElement
  const dark = root.getAttribute('data-theme') === 'dark'
  const raw = getComputedStyle(root).getPropertyValue('--accent').trim() || '#2563eb'
  const accent = new THREE.Color()
  try { accent.setStyle(raw) } catch { accent.set('#2563eb') }
  return { accent, dark }
}

export default function LoginCanvas({ mode = 'idle' }: { mode?: LoginCanvasMode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<LoginCanvasMode>(mode)
  const kickRef = useRef<() => void>(() => {})

  useEffect(() => {
    modeRef.current = mode
    kickRef.current()
  }, [mode])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      return // No WebGL: the page's gradient stands in.
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const small = window.innerWidth < 640
    const pixelRatio = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75)
    renderer.setPixelRatio(pixelRatio)
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200)
    const lookAt = new THREE.Vector3(0, 1.2, -6)
    let camY = 7.5

    // ── The data surface ──────────────────────────────────────────────────────
    const cols = small ? 96 : 170
    const rows = small ? 64 : 104
    const positions = new Float32Array(cols * rows * 3)
    const rand = new Float32Array(cols * rows)
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const k = i * cols + j
        positions[k * 3]     = (j / (cols - 1) - 0.5) * 64 + (Math.random() - 0.5) * 0.18
        positions[k * 3 + 1] = 0
        positions[k * 3 + 2] = (i / (rows - 1) - 0.5) * 44 + (Math.random() - 0.5) * 0.18
        rand[k] = Math.random()
      }
    }
    const surfaceGeo = new THREE.BufferGeometry()
    surfaceGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    surfaceGeo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1))
    const surfaceMat = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uPulse: { value: 0 }, uSurge: { value: 0 }, uAlert: { value: 0 },
        uPixelRatio: { value: pixelRatio }, uSize: { value: small ? 190 : 160 },
        uColorA: { value: new THREE.Color() }, uColorB: { value: new THREE.Color() }, uAlpha: { value: 1 },
      },
    })
    const surface = new THREE.Points(surfaceGeo, surfaceMat)
    scene.add(surface)

    // ── The trend line and its markers ───────────────────────────────────────
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-30, 1.2, 6), new THREE.Vector3(-18, 2.4, 3), new THREE.Vector3(-8, 2.0, 1),
      new THREE.Vector3(2, 4.4, -1), new THREE.Vector3(12, 5.6, -3), new THREE.Vector3(22, 8.4, -6),
      new THREE.Vector3(32, 10.6, -9),
    ])
    const lineGeo = new THREE.TubeGeometry(curve, 240, 0.12, 8, false)
    const lineMat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 1 },
        uSpeed: { value: 0.12 }, uAlert: { value: 0 },
      },
    })
    scene.add(new THREE.Mesh(lineGeo, lineMat))

    const markerGeo = new THREE.SphereGeometry(0.22, 16, 16)
    const markerMat = new THREE.MeshBasicMaterial({ transparent: true })
    const markers = [0.18, 0.42, 0.66, 0.9].map(t => {
      const m = new THREE.Mesh(markerGeo, markerMat)
      m.position.copy(curve.getPoint(t))
      scene.add(m)
      return m
    })

    // ── Theme ────────────────────────────────────────────────────────────────
    const applyTheme = () => {
      const { accent, dark } = readTheme()
      const deep = accent.clone().lerp(new THREE.Color(dark ? 0x0b1020 : 0x0f172a), dark ? 0.35 : 0.15)
      const bright = accent.clone().lerp(new THREE.Color(0xffffff), dark ? 0.55 : 0.1)
      surfaceMat.uniforms.uColorA.value.copy(dark ? deep : accent.clone().lerp(new THREE.Color(0xffffff), 0.2))
      surfaceMat.uniforms.uColorB.value.copy(dark ? bright : deep)
      surfaceMat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending
      surfaceMat.uniforms.uAlpha.value = dark ? 0.95 : 0.85
      lineMat.uniforms.uColor.value.copy(dark ? bright : accent)
      lineMat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending
      markerMat.color.copy(dark ? bright : accent)
      surfaceMat.needsUpdate = true
      lineMat.needsUpdate = true
    }
    applyTheme()
    const themeWatch = new MutationObserver(() => { applyTheme(); kick() })
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })

    // ── Size, pointer, loop ──────────────────────────────────────────────────
    const resize = () => {
      // The host's own box: on a phone it covers only the top of the screen (auth.css).
      const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camera.aspect = w / h
      // A narrow, tall box sees a thin slice of the field: step back so the trend line still
      // crosses it from edge to edge.
      const tall = w < h * 1.1
      camY = tall ? 8.5 : 7.5
      lookAt.set(0, 1.4, -6)
      camera.position.set(0, camY, tall ? 34 : 21)
      camera.updateProjectionMatrix()
      kick()
    }
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
    }

    const clock = new THREE.Clock()
    let t = 0
    let pulse = 0, surge = 0, alert = 0
    let raf = 0
    let running = false

    const frame = () => {
      const dt = Math.min(clock.getDelta(), 0.05)
      const m = modeRef.current
      const busy = m === 'busy', success = m === 'success', error = m === 'error'
      // Everything speeds up a little while signing in and surges on success.
      t += dt * (success ? 2.2 : busy ? 1.5 : 1)
      pulse += ((busy || success ? 1 : 0) - pulse) * Math.min(1, dt * 3)
      surge += ((success ? 1 : 0) - surge) * Math.min(1, dt * 2.5)
      alert += ((error ? 1 : 0) - alert) * Math.min(1, dt * 4)
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2)
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2)

      surfaceMat.uniforms.uTime.value = t
      surfaceMat.uniforms.uPulse.value = pulse
      surfaceMat.uniforms.uSurge.value = surge
      surfaceMat.uniforms.uAlert.value = alert
      lineMat.uniforms.uTime.value = t
      lineMat.uniforms.uSpeed.value = busy || success ? 0.32 : 0.12
      lineMat.uniforms.uAlert.value = alert
      markers.forEach((mk, i) => mk.scale.setScalar(1 + 0.35 * Math.sin(t * 2.2 + i * 1.3) + surge * 0.8))

      camera.position.x = Math.sin(t * 0.06) * 3 + pointer.x * 2.6
      camera.position.y = camY - pointer.y * 1.4
      camera.lookAt(lookAt)
      renderer.render(scene, camera)
    }

    const loop = () => {
      frame()
      raf = requestAnimationFrame(loop)
    }
    const start = () => {
      if (running || reduceMotion || document.hidden) return
      running = true
      clock.getDelta()
      raf = requestAnimationFrame(loop)
    }
    const stop = () => { running = false; cancelAnimationFrame(raf) }
    // With reduced motion there's no loop: draw one frame now and again whenever something changes.
    function kick() { if (reduceMotion || !running) frame() }
    kickRef.current = kick

    const onVisibility = () => (document.hidden ? stop() : start())

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointer, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    if (reduceMotion) frame(); else start()
    requestAnimationFrame(() => host.setAttribute('data-ready', ''))

    return () => {
      stop()
      kickRef.current = () => {}
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('visibilitychange', onVisibility)
      themeWatch.disconnect()
      surfaceGeo.dispose(); surfaceMat.dispose(); lineGeo.dispose(); lineMat.dispose()
      markerGeo.dispose(); markerMat.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={hostRef} className="au-canvas" aria-hidden />
}
