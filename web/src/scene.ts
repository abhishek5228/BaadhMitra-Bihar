import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { BIHAR } from '../../shared/geo'
import { PLACES } from '../../shared/gazetteer'
import type { Gauge, Inc } from '../../shared/types'

// Map size in scene units: 20 units per degree.
const W = (BIHAR.e - BIHAR.w) * 20
const D = (BIHAR.n - BIHAR.s) * 20
const px = (lon: number) => (lon - (BIHAR.w + BIHAR.e) / 2) * 20
const pz = (lat: number) => -(lat - (BIHAR.s + BIHAR.n) / 2) * 20

// Schematic river courses [lat, lon]. Approximate on purpose: this is a visual aid, not a survey.
const RIVERS: Record<string, [number, number][]> = {
  Ganga: [[25.56, 83.98], [25.6, 84.45], [25.64, 84.9], [25.62, 85.2], [25.48, 85.71], [25.4, 85.95], [25.38, 86.47], [25.26, 87.0], [25.45, 87.27], [25.35, 87.62], [25.3, 87.9]],
  Gandak: [[27.4, 84.0], [26.8, 84.35], [26.3, 84.58], [26.0, 84.85], [25.8, 85.05], [25.69, 85.22]],
  Kosi: [[26.55, 87.0], [26.28, 86.85], [25.9, 87.08], [25.6, 87.22], [25.5, 87.3]],
  'Burhi Gandak': [[26.9, 84.6], [26.65, 84.92], [26.12, 85.39], [25.86, 85.78], [25.5, 86.47]],
}

// ---- terrain height ---------------------------------------------------------
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const fbm = (x: number, y: number) => 0.5 * vnoise(x, y) + 0.25 * vnoise(x * 2.1, y * 2.1) + 0.125 * vnoise(x * 4.3, y * 4.3)
const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function dseg(lat: number, lon: number, a: [number, number], b: [number, number]): number {
  const [y1, x1] = a
  const [y2, x2] = b
  const dx = x2 - x1
  const dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(lon - (x1 + t * dx), lat - (y1 + t * dy))
}
function driver(lat: number, lon: number): number {
  let m = 9
  for (const r of Object.values(RIVERS)) for (let i = 0; i < r.length - 1; i++) m = Math.min(m, dseg(lat, lon, r[i], r[i + 1]))
  return m
}

/** Stylised Bihar: Himalayan foothills in the north, low Gangetic plain, plateau in the south, rivers in shallow valleys. */
export function hAt(lat: number, lon: number): number {
  const foot = ss(26.55, 27.6, lat) * 6.2
  const south = ss(25.1, 24.2, lat) * 3.4
  const plain = fbm(lon * 3.1, lat * 3.1) * 0.55
  const valley = Math.min(1, driver(lat, lon) / 0.45) * 0.5 // land rises away from the river, so low ground floods first
  const carve = Math.exp(-((driver(lat, lon) / 0.045) ** 2)) * 0.5
  return foot * (0.6 + fbm(lon * 2, lat * 2)) + south * (0.6 + fbm(lon * 2.5, lat * 2.5)) + plain + valley - carve - 0.25
}

const GREEN = new THREE.Color('#2fbf71')
const AMBER = new THREE.Color('#f5a524')
const RED = new THREE.Color('#e5484d')
export function urg(s: number): THREE.Color {
  const t = Math.min(1, Math.max(0, s / 100))
  return t < 0.5 ? GREEN.clone().lerp(AMBER, t * 2) : AMBER.clone().lerp(RED, (t - 0.5) * 2)
}

interface Bcn {
  g: THREE.Group
  bar: THREE.Mesh
  ring: THREE.Mesh
  tag: CSS2DObject
  boat?: THREE.Group
  born: number
}

export class World {
  private rn: THREE.WebGLRenderer
  private lr: CSS2DRenderer
  private sc = new THREE.Scene()
  private cam: THREE.PerspectiveCamera
  private ctl: OrbitControls
  private wat: THREE.Mesh
  private rain: THREE.Points
  private bcn = new Map<string, Bcn>()
  private tow = new Map<string, { g: THREE.Group; cap: THREE.Mesh; tag: CSS2DObject }>()
  private ray = new THREE.Raycaster()
  private ptr = new THREE.Vector2()
  private pick: THREE.Object3D[] = []
  private fly: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null
  private flood = 0
  private sel = ''
  private labels: CSS2DObject[] = []
  private idle = true
  private clock = new THREE.Clock()

  constructor(private el: HTMLElement, private onPick: (id: string) => void) {
    this.sc.background = new THREE.Color('#0b1220')
    this.sc.fog = new THREE.Fog('#0b1220', 90, 210)
    this.cam = new THREE.PerspectiveCamera(42, 1, 0.5, 600)
    this.cam.position.set(0, 62, 70)

    this.rn = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.rn.setPixelRatio(Math.min(devicePixelRatio, 2))
    el.appendChild(this.rn.domElement)
    this.lr = new CSS2DRenderer()
    this.lr.domElement.className = 'lbl-layer'
    el.appendChild(this.lr.domElement)

    this.ctl = new OrbitControls(this.cam, this.lr.domElement)
    this.ctl.enableDamping = true
    this.ctl.maxPolarAngle = Math.PI * 0.47
    this.ctl.minDistance = 12
    this.ctl.maxDistance = 140
    this.ctl.target.set(0, 0, 0)
    this.ctl.addEventListener('start', () => (this.idle = false))

    this.sc.add(new THREE.HemisphereLight('#b9d4ff', '#2b3a2a', 1.15))
    const sun = new THREE.DirectionalLight('#fff3d6', 1.6)
    sun.position.set(-40, 70, 30)
    this.sc.add(sun)

    this.buildTerrain()
    this.buildRivers()
    this.wat = this.buildWater()
    this.rain = this.buildRain()
    this.buildLabels()

    this.lr.domElement.addEventListener('pointerdown', (e) => this.onDown(e))
    this.lr.domElement.addEventListener('pointermove', (e) => this.onMove(e))
    new ResizeObserver(() => this.resize()).observe(el)
    this.resize()
    this.rn.setAnimationLoop(() => this.frame())
  }

  // ---- static scenery -------------------------------------------------------
  private buildTerrain(): void {
    const nx = 220
    const nz = 150
    const g = new THREE.PlaneGeometry(W, D, nx, nz)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    const col = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const lon = x / 20 + (BIHAR.w + BIHAR.e) / 2
      const lat = -z / 20 + (BIHAR.s + BIHAR.n) / 2
      const h = hAt(lat, lon)
      pos.setY(i, h)
      const n = fbm(lon * 9, lat * 9)
      if (h < 0.2) c.set('#5f8a58')
      else if (h < 0.9) c.set('#7fae5b').lerp(new THREE.Color('#9bbd62'), n)
      else if (h < 2.4) c.set('#8f9a5a').lerp(new THREE.Color('#8b7b55'), Math.min(1, (h - 0.9) / 1.5))
      else c.set('#8b7b55').lerp(new THREE.Color('#b8b2a4'), Math.min(1, (h - 2.4) / 3.5))
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.computeVertexNormals()
    this.sc.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })))
  }

  private buildRivers(): void {
    for (const [name, pts] of Object.entries(RIVERS)) {
      const v = pts.map(([la, lo]) => new THREE.Vector3(px(lo), hAt(la, lo) + 0.02, pz(la)))
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v), 120, name === 'Ganga' ? 0.22 : 0.14, 6),
        new THREE.MeshStandardMaterial({ color: '#2d7fc4', roughness: 0.3 }),
      )
      this.sc.add(tube)
      const mid = v[Math.floor(v.length / 2)]
      this.label(name, mid.x, mid.y + 0.5, mid.z, 'rv')
    }
  }

  private buildWater(): THREE.Mesh {
    const g = new THREE.PlaneGeometry(W, D, 90, 60)
    g.rotateX(-Math.PI / 2)
    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ color: '#2b86d1', transparent: true, opacity: 0.74, roughness: 0.15, metalness: 0.1, depthWrite: false }),
    )
    m.position.y = 0
    this.sc.add(m)
    return m
  }

  private buildRain(): THREE.Points {
    const n = 1800
    const p = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * W * 0.8
      p[i * 3 + 1] = Math.random() * 50
      p[i * 3 + 2] = (Math.random() - 0.5) * D * 0.8
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: '#a9c8ff', size: 0.22, transparent: true, opacity: 0 }))
    this.sc.add(pts)
    return pts
  }

  private label(text: string, x: number, y: number, z: number, cls: string): CSS2DObject {
    const d = document.createElement('div')
    d.className = 'lbl ' + cls
    d.textContent = text // never innerHTML: some label text is user-supplied
    const o = new CSS2DObject(d)
    o.position.set(x, y, z)
    this.sc.add(o)
    return o
  }

  private buildLabels(): void {
    for (const p of PLACES.slice(0, 22)) this.labels.push(this.label(p.en, px(p.lon), hAt(p.lat, p.lon) + 0.35, pz(p.lat), 'dist'))
  }

  // ---- live data ------------------------------------------------------------
  setGauges(gs: Gauge[]): void {
    let f = 0
    for (const g of gs) {
      f += Math.min(1, Math.max(0, (g.lvl - (g.danger - 1.5)) / 2.5))
      const col = g.stale ? '#7b8494' : g.state === 'danger' ? '#e5484d' : g.state === 'warn' ? '#f5a524' : '#2fbf71'
      let t = this.tow.get(g.id)
      const h = hAt(g.lat, g.lon)
      if (!t) {
        const grp = new THREE.Group()
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), new THREE.MeshStandardMaterial({ color: '#cfd8e6' }))
        pole.position.y = 1.1
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9 }))
        cap.position.y = 2.3
        grp.add(pole, cap)
        grp.position.set(px(g.lon), h, pz(g.lat))
        this.sc.add(grp)
        const tag = this.label('', px(g.lon), h + 3.1, pz(g.lat), 'gau')
        t = { g: grp, cap, tag }
        this.tow.set(g.id, t)
      }
      const mat = t.cap.material as THREE.MeshStandardMaterial
      mat.color.set(col)
      mat.emissive.set(col)
      t.tag.element.textContent = `${g.name} ${g.lvl.toFixed(2)}m${g.sim ? ' (sim)' : ''}${g.stale ? ' (old)' : ''}`
      t.tag.element.className = 'lbl gau ' + g.state
    }
    this.flood = gs.length ? f / gs.length : 0
  }

  setIncidents(list: Inc[]): void {
    const live = new Set(list.map((i) => i.id))
    for (const [id, b] of this.bcn)
      if (!live.has(id)) {
        this.sc.remove(b.g)
        this.sc.remove(b.tag)
        this.bcn.delete(id)
      }
    const top = new Set(list.slice(0, 5).map((i) => i.id))
    for (const i of list) {
      let b = this.bcn.get(i.id)
      const x = px(i.lon)
      const z = pz(i.lat)
      const y = Math.max(hAt(i.lat, i.lon), this.waterY()) + 0.02
      const ht = 1.2 + Math.log2(i.raw + 1) * 0.9
      if (!b) {
        const g = new THREE.Group()
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1, 14), new THREE.MeshStandardMaterial({ roughness: 0.35 }))
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 32), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, side: THREE.DoubleSide }))
        ring.rotation.x = -Math.PI / 2
        bar.userData.id = i.id
        g.add(bar, ring)
        this.sc.add(g)
        const tag = this.label('', x, y + ht + 0.9, z, 'inc')
        b = { g, bar, ring, tag, born: performance.now() }
        this.bcn.set(i.id, b)
      }
      b.g.position.set(x, y, z)
      b.bar.scale.y = ht
      b.bar.position.y = ht / 2
      const col = i.status === 'assigned' ? new THREE.Color('#4da3ff') : urg(i.score)
      const bm = b.bar.material as THREE.MeshStandardMaterial
      bm.color.copy(col)
      bm.emissive.copy(col)
      bm.emissiveIntensity = i.status === 'assigned' ? 0.35 : 0.6
      ;(b.ring.material as THREE.MeshBasicMaterial).color.copy(col)
      b.tag.position.set(x, y + ht + 0.9, z)
      b.tag.element.textContent = `${i.place} ${i.score}`
      b.tag.element.className = 'lbl inc' + (i.review ? ' rev' : '')
      b.tag.visible = top.has(i.id) || i.id === this.sel
      if (i.status === 'assigned' && !b.boat) b.boat = this.spawnBoat(b)
      if (i.status !== 'assigned' && b.boat) {
        this.sc.remove(b.boat)
        b.boat = undefined
      }
    }
    this.pick = [...this.bcn.values()].map((b) => b.bar)
  }

  private spawnBoat(b: Bcn): THREE.Group {
    const g = new THREE.Group()
    const hull = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.1, 5), new THREE.MeshStandardMaterial({ color: '#ffd166' }))
    hull.rotation.x = Math.PI / 2
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }))
    sail.position.y = 0.5
    g.add(hull, sail)
    g.userData = { from: new THREE.Vector3(px(85.14), 0, pz(25.61)), t: 0, home: b.g }
    this.sc.add(g)
    return g
  }

  private waterY(): number {
    return 0.0 + this.flood * 0.5
  }

  select(id: string): void {
    this.sel = id
    const b = this.bcn.get(id)
    if (!b) return
    this.idle = false
    const t = b.g.position.clone()
    this.fly = { from: this.ctl.target.clone(), to: t, t: 0 }
    for (const [k, v] of this.bcn) v.tag.visible = v.tag.visible || k === id
  }

  // ---- interaction ----------------------------------------------------------
  private hit(e: PointerEvent): string {
    const r = this.lr.domElement.getBoundingClientRect()
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.ptr, this.cam)
    const h = this.ray.intersectObjects(this.pick, false)[0]
    return (h?.object.userData.id as string) ?? ''
  }
  private down = { x: 0, y: 0 }
  private onDown(e: PointerEvent): void {
    this.down = { x: e.clientX, y: e.clientY }
    const up = (u: PointerEvent) => {
      this.lr.domElement.removeEventListener('pointerup', up)
      if (Math.hypot(u.clientX - this.down.x, u.clientY - this.down.y) > 5) return // it was a drag
      const id = this.hit(u)
      if (id) this.onPick(id)
    }
    this.lr.domElement.addEventListener('pointerup', up)
  }
  private onMove(e: PointerEvent): void {
    this.lr.domElement.style.cursor = e.buttons ? 'grabbing' : this.hit(e) ? 'pointer' : 'grab'
  }

  private resize(): void {
    const w = this.el.clientWidth || 1
    const h = this.el.clientHeight || 1
    this.rn.setSize(w, h)
    this.lr.setSize(w, h)
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
  }

  // ---- animation ------------------------------------------------------------
  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta())
    const t = this.clock.elapsedTime

    // water rises smoothly toward the level implied by the gauges
    const wy = this.waterY()
    this.wat.position.y += (wy - this.wat.position.y) * Math.min(1, dt * 1.5)
    const wp = (this.wat.geometry as THREE.PlaneGeometry).attributes.position as THREE.BufferAttribute
    for (let i = 0; i < wp.count; i++) wp.setY(i, Math.sin(wp.getX(i) * 0.4 + t * 1.6) * 0.04 + Math.cos(wp.getZ(i) * 0.5 + t * 1.2) * 0.035)
    wp.needsUpdate = true

    // rain falls harder as the flood index rises
    const rm = this.rain.material as THREE.PointsMaterial
    rm.opacity = Math.min(0.7, this.flood * 1.1)
    if (rm.opacity > 0.02) {
      const rp = this.rain.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < rp.count; i++) {
        let y = rp.getY(i) - dt * 28
        if (y < 0) y = 50
        rp.setY(i, y)
      }
      rp.needsUpdate = true
    }

    for (const b of this.bcn.values()) {
      const k = (t * 0.9 + b.born * 0.001) % 1
      b.ring.scale.setScalar(1 + k * 2.2)
      ;(b.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k)
      if (b.boat) {
        const u = b.boat.userData as { from: THREE.Vector3; t: number }
        u.t = Math.min(1, u.t + dt / 18)
        const to = b.g.position
        b.boat.position.lerpVectors(u.from, to, u.t)
        b.boat.position.y = wy + 0.15 + Math.sin(t * 3) * 0.04
        b.boat.lookAt(to.x, b.boat.position.y, to.z)
        if (u.t >= 1) {
          b.boat.position.x += Math.cos(t * 1.4) * 0.9 // circle the incident while on station
          b.boat.position.z += Math.sin(t * 1.4) * 0.9
        }
      }
    }

    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt * 1.6)
      const e = 1 - (1 - this.fly.t) ** 3
      const nt = new THREE.Vector3().lerpVectors(this.fly.from, this.fly.to, e)
      const off = this.cam.position.clone().sub(this.ctl.target)
      off.setLength(Math.min(off.length(), 34))
      this.ctl.target.copy(nt)
      this.cam.position.copy(nt.clone().add(off))
      if (this.fly.t >= 1) this.fly = null
    } else if (this.idle) {
      const a = dt * 0.05
      const p = this.cam.position
      const x = p.x * Math.cos(a) - p.z * Math.sin(a)
      p.z = p.x * Math.sin(a) + p.z * Math.cos(a)
      p.x = x
    }

    // hide dense district labels when zoomed far out so the map stays readable
    const far = this.cam.position.distanceTo(this.ctl.target) > 85
    for (const l of this.labels) l.visible = !far

    this.ctl.update()
    this.rn.render(this.sc, this.cam)
    this.lr.render(this.sc, this.cam)
  }
}
