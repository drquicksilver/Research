// ---------------------------------------------------------------------------
// Approach 1: Sequential Impulses (projected Gauss-Seidel on the velocity LCP)
// ---------------------------------------------------------------------------
//
// The Box2D / Erin Catto formulation:
//
//   1. integrate velocities (gravity, external forces)
//   2. prepare contact constraints, warm start from last frame's impulses
//   3. N velocity iterations: for every contact point apply a corrective impulse
//      with *accumulated* impulse clamping (that clamp is what makes this a
//      projected Gauss-Seidel on the LCP rather than a naive impulse loop)
//   4. a separate restitution pass so bounce is not eaten by the friction loop
//   5. integrate positions
//   6. M position iterations of non-linear Gauss-Seidel: recompute geometry,
//      push overlapping pairs apart, no velocity change
//
// The two details that decide whether a card tower stands up:
//   * warm starting  — the stack's support impulses survive between frames, so
//     the solver starts from the answer instead of rediscovering it in 8 sweeps
//   * the block solver — a 2-point manifold is solved as a coupled 2x2 LCP, so a
//     box resting on a box does not rock between its two corners
//
// This file is the ONLY thing that differs from the XPBD build (plus xpbd.js).

import { Broadphase } from '../core/broadphase.js';
import { collide, createManifold, updateAnchors, LINEAR_SLOP, SPECULATIVE_DISTANCE } from '../core/collide.js';
import { SleepManager, clampMotion } from '../core/sleep.js';

const BAUMGARTE = 0.2;             // position correction fraction per iteration
const MAX_LINEAR_CORRECTION = 0.2; // m, stops a deep overlap from exploding
const RESTITUTION_THRESHOLD = 1.0; // m/s, below this collisions are inelastic

class Contact {
  constructor() {
    this.manifold = createManifold();
    this.key = 0;
    this.friction = 0;
    this.restitution = 0;
    this.touching = false;
    this.stamp = 0;
    // Block solver state for 2-point manifolds.
    this.k11 = 0; this.k12 = 0; this.k22 = 0;
    this.nm11 = 0; this.nm12 = 0; this.nm22 = 0;
    this.blockOk = false;
  }
  get bodyA() { return this.manifold.bodyA; }
  get bodyB() { return this.manifold.bodyB; }
}

export class World {
  constructor(opts = {}) {
    this.name = 'Sequential Impulses';
    this.bodies = [];
    this.gravity = { x: 0, y: opts.gravity != null ? opts.gravity : -9.81 };

    // 16 rather than Box2D's traditional 8: the house-of-cards scene needs it
    // (measured in sweep.js — at 8 the structure creeps and falls at ~4 s).
    this.velocityIterations = opts.velocityIterations != null ? opts.velocityIterations : 16;
    this.positionIterations = opts.positionIterations != null ? opts.positionIterations : 3;
    this.warmStarting = opts.warmStarting !== false;
    this.blockSolver = opts.blockSolver !== false;
    this.allowSleep = !!opts.allowSleep;

    this.broadphase = new Broadphase();
    // Inflate AABBs so speculative contacts (which act at a positive gap) are
    // actually reported by the broadphase.
    this.broadphase.margin = SPECULATIVE_DISTANCE;
    // Extend contact detection by how far a pair can close during one step, so
    // that fast bodies are caught before they are already through. Combined
    // with the speculative velocity bias this stops them exactly at the surface.
    // This is not full CCD — see README for the measured threshold.
    this.continuous = opts.continuous !== false;
    this.contacts = new Map();     // pair key -> Contact
    this.contactList = [];
    this.sleepManager = new SleepManager();
    this.scratch = createManifold();
    this.stamp = 0;
    this.time = 0;

    this.stats = {
      bodies: 0, contacts: 0, points: 0, sleeping: 0,
      maxPenetration: 0, avgPenetration: 0, energy: 0,
      broadMs: 0, narrowMs: 0, solveMs: 0, positionMs: 0, totalMs: 0,
      velocityIterations: this.velocityIterations,
      positionIterations: this.positionIterations,
      blockFallbacks: 0,
    };
  }

  /** Knobs the UI is allowed to expose, with ranges. Shared shape with XPBD. */
  static get params() {
    return [
      { key: 'velocityIterations', label: 'Velocity iterations', min: 1, max: 40, step: 1 },
      { key: 'positionIterations', label: 'Position iterations', min: 0, max: 20, step: 1 },
      { key: 'warmStarting', label: 'Warm starting', type: 'bool' },
      { key: 'blockSolver', label: 'Block solver (2-pt LCP)', type: 'bool' },
      { key: 'continuous', label: 'Speculative CCD', type: 'bool' },
    ];
  }

  addBody(b) { this.bodies.push(b); this.broadphase.reset(); return b; }

  removeBody(b) {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    this.broadphase.reset();
    for (const [k, c] of this.contacts) if (c.bodyA === b || c.bodyB === b) this.contacts.delete(k);
  }

  clear() { this.bodies.length = 0; this.contacts.clear(); this.contactList.length = 0; this.broadphase.reset(); this.time = 0; }

  wakeAll() { SleepManager.wakeAll(this.bodies); }

  step(dt) {
    if (dt <= 0) return;
    const t0 = now();
    this.stamp++;
    this.time += dt;
    const invDt = 1 / dt;

    for (const b of this.bodies) b.updateTransform();

    const t1 = now();
    this.broadphase.motionDt = this.continuous ? dt : 0;
    const nPairs = this.broadphase.update(this.bodies);
    const t2 = now();
    this.collectContacts(nPairs, dt);
    const t3 = now();

    this.integrateVelocities(dt);
    this.prepareContacts(invDt);
    if (this.warmStarting) this.warmStart();

    for (let i = 0; i < this.velocityIterations; i++) this.solveVelocities();
    this.applyRestitution();

    const t4 = now();
    this.integratePositions(dt);
    const minSep = this.solvePositions();
    const t5 = now();

    for (const b of this.bodies) b.updateTransform();

    if (this.allowSleep) {
      this.stats.sleeping = this.sleepManager.update(this.bodies, this.contactList, dt);
    } else {
      this.stats.sleeping = 0;
      for (const b of this.bodies) b.sleeping = false;
    }

    this.collectStats(minSep, t0, t1, t2, t3, t4, t5);
  }

  // -- pipeline stages -------------------------------------------------------

  collectContacts(nPairs, dt) {
    const pairs = this.broadphase.pairs;
    const list = this.contactList;
    list.length = 0;
    for (let i = 0; i < nPairs; i++) {
      const p = pairs[i];
      let c = this.contacts.get(p.key);
      if (!c) { c = new Contact(); c.key = p.key; this.contacts.set(p.key, c); }

      // Cache the previous manifold's impulses keyed by feature id.
      const m = c.manifold;
      const oldCount = c.touching ? m.count : 0;
      let o0n = 0, o0t = 0, o0id = -1, o1n = 0, o1t = 0, o1id = -1;
      if (oldCount > 0) { o0n = m.points[0].normalImpulse; o0t = m.points[0].tangentImpulse; o0id = m.points[0].id; }
      if (oldCount > 1) { o1n = m.points[1].normalImpulse; o1t = m.points[1].tangentImpulse; o1id = m.points[1].id; }

      // Widen the acceptance distance by how far this pair can close in one
      // step. The resulting contact is speculative: the solver clamps the
      // approach to exactly the gap, so the body lands on the surface.
      let maxDist = SPECULATIVE_DISTANCE;
      if (this.continuous) {
        const va = p.a.linearVelocity, vb = p.b.linearVelocity;
        maxDist += dt * (Math.hypot(va.x, va.y) + Math.hypot(vb.x, vb.y));
      }
      const count = collide(p.a, p.b, m, maxDist);
      c.touching = count > 0;
      c.stamp = this.stamp;
      if (!count) continue;

      for (let k = 0; k < count; k++) {
        const pt = m.points[k];
        pt.warmStarted = false;
        pt.normalImpulse = 0; pt.tangentImpulse = 0;
        if (pt.id === o0id) { pt.normalImpulse = o0n; pt.tangentImpulse = o0t; pt.warmStarted = true; }
        else if (pt.id === o1id) { pt.normalImpulse = o1n; pt.tangentImpulse = o1t; pt.warmStarted = true; }
      }

      const A = m.bodyA, B = m.bodyB;
      c.friction = Math.sqrt(A.friction * B.friction);
      c.restitution = Math.max(A.restitution, B.restitution);
      list.push(c);
      if (A.sleeping && (!B.sleeping && !B.isStatic)) A.wake();
      if (B.sleeping && (!A.sleeping && !A.isStatic)) B.wake();
    }

    // Drop pair caches that no longer overlap so the map does not grow forever.
    if ((this.stamp & 31) === 0) {
      for (const [k, c] of this.contacts) if (c.stamp !== this.stamp) this.contacts.delete(k);
    }
  }

  integrateVelocities(dt) {
    const g = this.gravity;
    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;
      b.linearVelocity.x += dt * (g.x + b.invMass * b.force.x);
      b.linearVelocity.y += dt * (g.y + b.invMass * b.force.y);
      b.angularVelocity += dt * b.invInertia * b.torque;
      b.force.x = 0; b.force.y = 0; b.torque = 0;
      clampMotion(b, dt);
    }
  }

  prepareContacts(invDt) {
    for (const c of this.contactList) {
      const m = c.manifold;
      const A = m.bodyA, B = m.bodyB;
      const nx = m.normal.x, ny = m.normal.y;
      const tx = ny, ty = -nx;   // tangent = perp(normal)
      const imA = A.invMass, imB = B.invMass, iiA = A.invInertia, iiB = B.invInertia;
      updateAnchors(m);

      for (let i = 0; i < m.count; i++) {
        const p = m.points[i];
        const rnA = p.rax * ny - p.ray * nx;
        const rnB = p.rbx * ny - p.rby * nx;
        const kn = imA + imB + iiA * rnA * rnA + iiB * rnB * rnB;
        p.normalMass = kn > 0 ? 1 / kn : 0;

        const rtA = p.rax * ty - p.ray * tx;
        const rtB = p.rbx * ty - p.rby * tx;
        const kt = imA + imB + iiA * rtA * rtA + iiB * rtB * rtB;
        p.tangentMass = kt > 0 ? 1 / kt : 0;

        // Speculative contact: if the shapes are still apart, allow them to
        // approach exactly fast enough to touch and no faster. The constraint
        // is vn >= -separation/dt, so the bias enters the solve as (vn + bias).
        // Getting this sign wrong turns every near-contact into a repulsor.
        p.velocityBias = p.separation > 0 ? p.separation * invDt : 0;

        // Approach speed captured before the solve, used by the restitution pass.
        const dvx = (B.linearVelocity.x - B.angularVelocity * p.rby) - (A.linearVelocity.x - A.angularVelocity * p.ray);
        const dvy = (B.linearVelocity.y + B.angularVelocity * p.rbx) - (A.linearVelocity.y + A.angularVelocity * p.rax);
        p.relativeVelocity = dvx * nx + dvy * ny;
      }

      // Pre-factor the 2x2 block system for two-point manifolds.
      c.blockOk = false;
      if (this.blockSolver && m.count === 2) {
        const p1 = m.points[0], p2 = m.points[1];
        const rn1A = p1.rax * ny - p1.ray * nx, rn1B = p1.rbx * ny - p1.rby * nx;
        const rn2A = p2.rax * ny - p2.ray * nx, rn2B = p2.rbx * ny - p2.rby * nx;
        const k11 = imA + imB + iiA * rn1A * rn1A + iiB * rn1B * rn1B;
        const k22 = imA + imB + iiA * rn2A * rn2A + iiB * rn2B * rn2B;
        const k12 = imA + imB + iiA * rn1A * rn2A + iiB * rn1B * rn2B;
        // Reject ill-conditioned systems (near-collinear rows); fall back to
        // point-by-point Gauss-Seidel in that case.
        const det = k11 * k22 - k12 * k12;
        if (k11 * k11 < 1000 * det) {
          const invDet = 1 / det;
          c.k11 = k11; c.k12 = k12; c.k22 = k22;
          c.nm11 = k22 * invDet; c.nm12 = -k12 * invDet; c.nm22 = k11 * invDet;
          c.blockOk = true;
        }
      }
    }
  }

  warmStart() {
    for (const c of this.contactList) {
      const m = c.manifold;
      const A = m.bodyA, B = m.bodyB;
      const nx = m.normal.x, ny = m.normal.y;
      const tx = ny, ty = -nx;
      for (let i = 0; i < m.count; i++) {
        const p = m.points[i];
        if (!p.warmStarted) continue;
        const px = p.normalImpulse * nx + p.tangentImpulse * tx;
        const py = p.normalImpulse * ny + p.tangentImpulse * ty;
        applyPair(A, B, px, py, p);
      }
    }
  }

  solveVelocities() {
    for (const c of this.contactList) {
      const m = c.manifold;
      const A = m.bodyA, B = m.bodyB;
      const nx = m.normal.x, ny = m.normal.y;
      const tx = ny, ty = -nx;

      // --- friction first, using the normal impulse from the previous pass ---
      for (let i = 0; i < m.count; i++) {
        const p = m.points[i];
        const dvx = (B.linearVelocity.x - B.angularVelocity * p.rby) - (A.linearVelocity.x - A.angularVelocity * p.ray);
        const dvy = (B.linearVelocity.y + B.angularVelocity * p.rbx) - (A.linearVelocity.y + A.angularVelocity * p.rax);
        const vt = dvx * tx + dvy * ty;
        let lambda = -p.tangentMass * vt;
        const maxF = c.friction * p.normalImpulse;
        const old = p.tangentImpulse;
        p.tangentImpulse = Math.max(-maxF, Math.min(old + lambda, maxF));
        lambda = p.tangentImpulse - old;
        applyPair(A, B, lambda * tx, lambda * ty, p);
      }

      // --- normal constraints ---
      if (c.blockOk && m.count === 2) {
        this.solveBlock(c, A, B, nx, ny);
      } else {
        for (let i = 0; i < m.count; i++) {
          const p = m.points[i];
          const dvx = (B.linearVelocity.x - B.angularVelocity * p.rby) - (A.linearVelocity.x - A.angularVelocity * p.ray);
          const dvy = (B.linearVelocity.y + B.angularVelocity * p.rbx) - (A.linearVelocity.y + A.angularVelocity * p.rax);
          const vn = dvx * nx + dvy * ny;
          let lambda = -p.normalMass * (vn + p.velocityBias);
          const old = p.normalImpulse;
          p.normalImpulse = Math.max(old + lambda, 0);   // accumulated clamp
          lambda = p.normalImpulse - old;
          applyPair(A, B, lambda * nx, lambda * ny, p);
        }
      }
    }
  }

  /**
   * Solve both normal constraints of a 2-point manifold simultaneously.
   *
   * A box resting on a box has two contact points whose constraints are
   * strongly coupled: pushing at one corner rotates the body into the other.
   * Point-by-point Gauss-Seidel ping-pongs between them and the box visibly
   * rocks. Solving the 2x2 LCP directly removes that mode. Four cases:
   * both points active, only one active (twice), neither active.
   */
  solveBlock(c, A, B, nx, ny) {
    const m = c.manifold;
    const p1 = m.points[0], p2 = m.points[1];
    const a1 = p1.normalImpulse, a2 = p2.normalImpulse;

    const dv1x = (B.linearVelocity.x - B.angularVelocity * p1.rby) - (A.linearVelocity.x - A.angularVelocity * p1.ray);
    const dv1y = (B.linearVelocity.y + B.angularVelocity * p1.rbx) - (A.linearVelocity.y + A.angularVelocity * p1.rax);
    const dv2x = (B.linearVelocity.x - B.angularVelocity * p2.rby) - (A.linearVelocity.x - A.angularVelocity * p2.ray);
    const dv2y = (B.linearVelocity.y + B.angularVelocity * p2.rbx) - (A.linearVelocity.y + A.angularVelocity * p2.rax);
    let vn1 = dv1x * nx + dv1y * ny;
    let vn2 = dv2x * nx + dv2y * ny;

    // b = velocity error with the current accumulated impulses removed.
    let b1 = vn1 + p1.velocityBias - (c.k11 * a1 + c.k12 * a2);
    let b2 = vn2 + p2.velocityBias - (c.k12 * a1 + c.k22 * a2);

    let x1 = 0, x2 = 0, solved = false;

    // Case 1: both constraints active.
    x1 = -(c.nm11 * b1 + c.nm12 * b2);
    x2 = -(c.nm12 * b1 + c.nm22 * b2);
    if (x1 >= 0 && x2 >= 0) solved = true;

    // Case 2: only point 1 active.
    if (!solved) {
      x1 = -p1.normalMass * b1; x2 = 0;
      vn2 = c.k12 * x1 + b2;
      if (x1 >= 0 && vn2 >= 0) solved = true;
    }
    // Case 3: only point 2 active.
    if (!solved) {
      x1 = 0; x2 = -p2.normalMass * b2;
      vn1 = c.k12 * x2 + b1;
      if (x2 >= 0 && vn1 >= 0) solved = true;
    }
    // Case 4: neither active (both separating).
    if (!solved) {
      x1 = 0; x2 = 0;
      vn1 = b1; vn2 = b2;
      if (vn1 >= 0 && vn2 >= 0) solved = true;
    }
    if (!solved) {
      // No consistent case (can happen with numerical noise): keep the current
      // impulses and let the next iteration try again.
      this.stats.blockFallbacks++;
      return;
    }

    const d1 = x1 - a1, d2 = x2 - a2;
    applyPair(A, B, d1 * nx, d1 * ny, p1);
    applyPair(A, B, d2 * nx, d2 * ny, p2);
    p1.normalImpulse = x1;
    p2.normalImpulse = x2;
  }

  /**
   * Restitution as a separate pass after the main solve. Mixing it into the
   * velocity iterations makes stacks jitter, because every iteration re-injects
   * bounce energy that the other contacts then have to absorb.
   */
  applyRestitution() {
    for (const c of this.contactList) {
      if (c.restitution === 0) continue;
      const m = c.manifold;
      const A = m.bodyA, B = m.bodyB;
      const nx = m.normal.x, ny = m.normal.y;
      for (let i = 0; i < m.count; i++) {
        const p = m.points[i];
        if (p.relativeVelocity > -RESTITUTION_THRESHOLD || p.normalImpulse === 0) continue;
        const dvx = (B.linearVelocity.x - B.angularVelocity * p.rby) - (A.linearVelocity.x - A.angularVelocity * p.ray);
        const dvy = (B.linearVelocity.y + B.angularVelocity * p.rbx) - (A.linearVelocity.y + A.angularVelocity * p.rax);
        const vn = dvx * nx + dvy * ny;
        let lambda = -p.normalMass * (vn + c.restitution * p.relativeVelocity);
        const old = p.normalImpulse;
        p.normalImpulse = Math.max(old + lambda, 0);
        lambda = p.normalImpulse - old;
        applyPair(A, B, lambda * nx, lambda * ny, p);
      }
    }
  }

  integratePositions(dt) {
    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;
      clampMotion(b, dt);
      b.position.x += dt * b.linearVelocity.x;
      b.position.y += dt * b.linearVelocity.y;
      b.angle += dt * b.angularVelocity;
    }
  }

  /**
   * Non-linear Gauss-Seidel position correction. Geometry is re-evaluated from
   * the current poses on every iteration (that is what makes it "non-linear"),
   * so deep overlaps unwind correctly instead of being linearised once.
   * Velocities are deliberately untouched: this removes drift without adding
   * the energy that a Baumgarte velocity bias would.
   */
  solvePositions() {
    let minSep = 0;
    for (let iter = 0; iter < this.positionIterations; iter++) {
      minSep = 0;
      for (const c of this.contactList) {
        const A = c.bodyA, B = c.bodyB;
        if ((A.isStatic || A.sleeping) && (B.isStatic || B.sleeping)) continue;
        A.updateTransform(); B.updateTransform();
        const m = this.scratch;
        if (!collide(A, B, m)) continue;
        const nx = m.normal.x, ny = m.normal.y;
        const imA = A.invMass, imB = B.invMass, iiA = A.invInertia, iiB = B.invInertia;
        for (let i = 0; i < m.count; i++) {
          const p = m.points[i];
          if (p.separation < minSep) minSep = p.separation;
          const rax = p.x - A.position.x, ray = p.y - A.position.y;
          const rbx = p.x - B.position.x, rby = p.y - B.position.y;
          const rnA = rax * ny - ray * nx;
          const rnB = rbx * ny - rby * nx;
          const k = imA + imB + iiA * rnA * rnA + iiB * rnB * rnB;
          if (k <= 0) continue;
          // Leave LINEAR_SLOP of overlap alone: contacts that are exactly
          // touching would otherwise be pushed apart and re-collide forever.
          const cErr = Math.max(-MAX_LINEAR_CORRECTION,
                                Math.min(BAUMGARTE * (p.separation + LINEAR_SLOP), 0));
          const impulse = -cErr / k;
          const px = impulse * nx, py = impulse * ny;
          if (!A.isStatic && !A.sleeping) {
            A.position.x -= imA * px; A.position.y -= imA * py;
            A.angle -= iiA * (rax * py - ray * px);
          }
          if (!B.isStatic && !B.sleeping) {
            B.position.x += imB * px; B.position.y += imB * py;
            B.angle += iiB * (rbx * py - rby * px);
          }
        }
      }
      // Early out once every overlap is within tolerance.
      if (minSep >= -3 * LINEAR_SLOP) break;
    }
    return minSep;
  }

  collectStats(minSep, t0, t1, t2, t3, t4, t5) {
    const s = this.stats;
    let points = 0, sumPen = 0, maxPen = 0, energy = 0;
    for (const c of this.contactList) {
      const m = c.manifold;
      for (let i = 0; i < m.count; i++) {
        const sep = m.points[i].separation;
        points++;
        if (sep < 0) { sumPen += -sep; if (-sep > maxPen) maxPen = -sep; }
      }
    }
    for (const b of this.bodies) energy += b.kineticEnergy();
    s.bodies = this.bodies.length;
    s.contacts = this.contactList.length;
    s.points = points;
    s.maxPenetration = maxPen;
    s.avgPenetration = points ? sumPen / points : 0;
    s.energy = energy;
    s.broadMs = t2 - t1;
    s.narrowMs = t3 - t2;
    s.solveMs = t4 - t3;
    s.positionMs = t5 - t4;
    s.totalMs = now() - t0;
    s.velocityIterations = this.velocityIterations;
    s.positionIterations = this.positionIterations;
  }

  /** Contact points for the debug renderer. */
  debugContacts() {
    const out = [];
    for (const c of this.contactList) {
      const m = c.manifold;
      for (let i = 0; i < m.count; i++) {
        const p = m.points[i];
        out.push({ x: p.x, y: p.y, nx: m.normal.x, ny: m.normal.y,
                   impulse: p.normalImpulse, warm: p.warmStarted, separation: p.separation });
      }
    }
    return out;
  }
}

function applyPair(A, B, px, py, p) {
  if (!A.isStatic && !A.sleeping) {
    A.linearVelocity.x -= A.invMass * px;
    A.linearVelocity.y -= A.invMass * py;
    A.angularVelocity -= A.invInertia * (p.rax * py - p.ray * px);
  }
  if (!B.isStatic && !B.sleeping) {
    B.linearVelocity.x += B.invMass * px;
    B.linearVelocity.y += B.invMass * py;
    B.angularVelocity += B.invInertia * (p.rbx * py - p.rby * px);
  }
}

const now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Number(process.hrtime.bigint() / 1000n) / 1000;
