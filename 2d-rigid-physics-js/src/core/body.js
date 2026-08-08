// Rigid bodies and convex shapes. Shared verbatim by both engines so that any
// behavioural difference between them is attributable to the solver alone.

import { v2, toWorld, EPS } from './math.js';

export const STATIC = 0;
export const DYNAMIC = 1;

let nextBodyId = 1;
export function resetBodyIds() { nextBodyId = 1; }

/**
 * Convex polygon shape. Vertices must be counter-clockwise. They are recentred
 * on the centroid so that body.position is always the centre of mass, which
 * keeps the inertia terms in the solver simple (no offset coupling).
 */
export function polygonShape(verts) {
  const n = verts.length;
  if (n < 3) throw new Error('polygon needs >= 3 vertices');

  // Signed area and centroid via the standard triangle fan decomposition.
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p = verts[i], q = verts[(i + 1) % n];
    const a = p.x * q.y - q.x * p.y;
    area += a;
    cx += (p.x + q.x) * a;
    cy += (p.y + q.y) * a;
  }
  area *= 0.5;
  if (area < 0) throw new Error('polygon vertices must be counter-clockwise');
  cx /= (6 * area);
  cy /= (6 * area);

  const local = verts.map((p) => v2(p.x - cx, p.y - cy));

  // Second moment of area about the centroid (per unit density).
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const p = local[i], q = local[(i + 1) % n];
    const c = p.x * q.y - q.x * p.y;
    num += c * ((p.x * p.x + p.x * q.x + q.x * q.x) + (p.y * p.y + p.y * q.y + q.y * q.y));
    den += c;
  }
  const inertiaPerArea = num / (6 * den);

  // Outward face normals, normal[i] belongs to edge local[i] -> local[i+1].
  const normals = [];
  for (let i = 0; i < n; i++) {
    const p = local[i], q = local[(i + 1) % n];
    const ex = q.x - p.x, ey = q.y - p.y;
    const l = Math.hypot(ex, ey);
    if (l < EPS) throw new Error('degenerate polygon edge');
    normals.push(v2(ey / l, -ex / l));
  }

  let radius = 0;
  for (const p of local) radius = Math.max(radius, Math.hypot(p.x, p.y));

  return { type: 'poly', verts: local, normals, area, inertiaPerArea, radius, centroid: v2(cx, cy) };
}

export function boxShape(hw, hh) {
  return polygonShape([v2(-hw, -hh), v2(hw, -hh), v2(hw, hh), v2(-hw, hh)]);
}

export function circleShape(r) {
  return { type: 'circle', verts: null, normals: null, area: Math.PI * r * r, inertiaPerArea: 0.5 * r * r, radius: r, centroid: v2(0, 0) };
}

export class Body {
  constructor(opts = {}) {
    this.id = nextBodyId++;
    this.shape = opts.shape;
    this.type = opts.type === STATIC || opts.static ? STATIC : DYNAMIC;

    this.position = v2(opts.x || 0, opts.y || 0);
    this.angle = opts.angle || 0;
    this.linearVelocity = v2(opts.vx || 0, opts.vy || 0);
    this.angularVelocity = opts.w || 0;

    this.density = opts.density != null ? opts.density : 1;
    this.friction = opts.friction != null ? opts.friction : 0.5;
    // Static friction defaults to the dynamic value. The XPBD engine uses both;
    // the sequential-impulse engine uses a single Coulomb cone as is standard.
    this.staticFriction = opts.staticFriction != null ? opts.staticFriction : this.friction;
    this.restitution = opts.restitution != null ? opts.restitution : 0;

    this.color = opts.color || null;
    this.label = opts.label || null;
    // Bodies flagged `tracked` are watched by the metrics code (e.g. tower apex).
    this.tracked = !!opts.tracked;

    if (this.type === STATIC) {
      this.mass = 0; this.invMass = 0; this.inertia = 0; this.invInertia = 0;
    } else {
      this.mass = this.shape.area * this.density;
      this.invMass = 1 / this.mass;
      this.inertia = this.mass * this.shape.inertiaPerArea;
      this.invInertia = this.inertia > 0 ? 1 / this.inertia : 0;
      if (opts.fixedRotation) { this.inertia = 0; this.invInertia = 0; }
    }

    // Force accumulator, cleared every step.
    this.force = v2(0, 0);
    this.torque = 0;

    // Cached world-space geometry, refreshed by updateTransform().
    this.worldVerts = this.shape.type === 'poly' ? this.shape.verts.map(() => v2()) : null;
    this.worldNormals = this.shape.type === 'poly' ? this.shape.normals.map(() => v2()) : null;
    this.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.sin = 0; this.cos = 1;

    // Sleep bookkeeping (used identically by both engines).
    this.sleepTime = 0;
    this.sleeping = false;

    // Previous pose, used by the XPBD integrator for velocity recovery and for
    // measuring per-substep tangential slip. It must start at the *current*
    // pose: static bodies are never touched by the integrator, and a zeroed
    // prevPose would make every static contact look like it had slid metres.
    this.prevPosition = v2(this.position.x, this.position.y);
    this.prevAngle = this.angle;

    this.updateTransform();
    this.initialPosition = v2(this.position.x, this.position.y);
    this.initialAngle = this.angle;
  }

  get isStatic() { return this.type === STATIC; }

  updateTransform() {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    this.cos = c; this.sin = s;
    const px = this.position.x, py = this.position.y;
    if (this.shape.type === 'poly') {
      const lv = this.shape.verts, ln = this.shape.normals;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < lv.length; i++) {
        const x = px + c * lv[i].x - s * lv[i].y;
        const y = py + s * lv[i].x + c * lv[i].y;
        this.worldVerts[i].x = x; this.worldVerts[i].y = y;
        this.worldNormals[i].x = c * ln[i].x - s * ln[i].y;
        this.worldNormals[i].y = s * ln[i].x + c * ln[i].y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      this.aabb.minX = minX; this.aabb.minY = minY;
      this.aabb.maxX = maxX; this.aabb.maxY = maxY;
    } else {
      const r = this.shape.radius;
      this.aabb.minX = px - r; this.aabb.maxX = px + r;
      this.aabb.minY = py - r; this.aabb.maxY = py + r;
    }
  }

  /** Velocity of the world-space point at offset r from the centre of mass. */
  pointVelocity(rx, ry) {
    return v2(this.linearVelocity.x - this.angularVelocity * ry,
              this.linearVelocity.y + this.angularVelocity * rx);
  }

  applyImpulse(px, py, rx, ry) {
    if (this.type === STATIC) return;
    this.linearVelocity.x += this.invMass * px;
    this.linearVelocity.y += this.invMass * py;
    this.angularVelocity += this.invInertia * (rx * py - ry * px);
  }

  applyForce(fx, fy) { this.force.x += fx; this.force.y += fy; }

  kineticEnergy() {
    if (this.type === STATIC) return 0;
    const v = this.linearVelocity;
    return 0.5 * this.mass * (v.x * v.x + v.y * v.y) + 0.5 * this.inertia * this.angularVelocity * this.angularVelocity;
  }

  worldPoint(local) { return toWorld(this, local); }

  wake() { this.sleeping = false; this.sleepTime = 0; }
}

/** Convenience factories used by the shared scenes. */
export function makeBox(x, y, hw, hh, opts = {}) {
  return new Body(Object.assign({ shape: boxShape(hw, hh), x, y }, opts));
}
export function makeCircle(x, y, r, opts = {}) {
  return new Body(Object.assign({ shape: circleShape(r), x, y }, opts));
}
export function makeStaticBox(x, y, hw, hh, opts = {}) {
  return new Body(Object.assign({ shape: boxShape(hw, hh), x, y, type: STATIC }, opts));
}
