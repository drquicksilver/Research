// Small 2D math helpers shared by both engines.
// Vectors are plain {x, y} objects. The hot solver loops use raw scalars rather
// than these helpers so we never allocate inside a step.

export const EPS = 1e-12;

export function v2(x = 0, y = 0) { return { x, y }; }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function mul(a, s) { return { x: a.x * s, y: a.y * s }; }
export function neg(a) { return { x: -a.x, y: -a.y }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y; }
// 2D "cross product": the z component of the 3D cross of two in-plane vectors.
export function cross(a, b) { return a.x * b.y - a.y * b.x; }
// cross(scalar w, vector v) -> vector, i.e. w x v
export function crossSV(s, v) { return { x: -s * v.y, y: s * v.x }; }
// cross(vector v, scalar w) -> vector
export function crossVS(v, s) { return { x: s * v.y, y: -s * v.x }; }
export function len(a) { return Math.hypot(a.x, a.y); }
export function lenSq(a) { return a.x * a.x + a.y * a.y; }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function normalize(a) {
  const l = Math.hypot(a.x, a.y);
  if (l < EPS) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

/** Rotate v by angle (radians). */
export function rotate(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

/** Rotate v by -angle. */
export function rotateT(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c * v.x + s * v.y, y: -s * v.x + c * v.y };
}

/** Body-local point -> world point. */
export function toWorld(body, p) {
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  return {
    x: body.position.x + c * p.x - s * p.y,
    y: body.position.y + s * p.x + c * p.y,
  };
}

/** World point -> body-local point. */
export function toLocal(body, p) {
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  const dx = p.x - body.position.x, dy = p.y - body.position.y;
  return { x: c * dx + s * dy, y: -s * dx + c * dy };
}

/** Deterministic 32-bit LCG. Both engines must see identical scene noise. */
export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }
  next() {
    // Numerical Recipes LCG constants; exact in float64.
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  /** Uniform in [-a, a]. */
  sym(a) { return (this.next() * 2 - 1) * a; }
  range(lo, hi) { return lo + this.next() * (hi - lo); }
}
