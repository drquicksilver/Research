// ---------------------------------------------------------------------------
// Approach 2: Substepped Extended Position Based Dynamics (XPBD)
// ---------------------------------------------------------------------------
//
// After Müller, Macklin, Chentanez, Jeschke & Kim, "Detailed Rigid Body
// Simulation with Extended Position Based Dynamics" (SCA 2020), reduced to 2D.
//
// Per visual frame with h = dt / substeps:
//
//   collect broadphase pairs once (AABBs inflated so they stay valid all frame)
//   for each substep:
//     save pose; v += h*g; integrate pose explicitly
//     build contacts
//     solve POSITIONS: non-penetration, then static friction
//     recover velocities by finite difference: v = (x - x_prev)/h
//     solve VELOCITIES: dynamic friction, then restitution
//
// The central claim of the paper is that N substeps x 1 iteration beats
// 1 step x N iterations for the same total work. The explicit integration
// between iterations keeps re-linearising the problem, so information
// propagates along a long contact chain across substeps instead of having to
// travel the whole chain inside one linear solve — which is exactly the failure
// mode of Gauss-Seidel on a tall stack.
//
// The other property that matters for a house of cards: friction is applied at
// the POSITION level. Static friction here means "undo the tangential slip that
// happened during this substep", which genuinely pins contacts rather than only
// damping their relative velocity.
//
// Contacts are stored as a pair of local anchors (the surface point on each
// body) plus the contact normal in the reference body's frame. Everything is
// then re-derived from the live poses, so corrections made by one constraint
// are immediately visible to the next — the defining property of PBD.
//
// This file is the ONLY thing that differs from the sequential-impulse build.

import { Broadphase } from '../core/broadphase.js';
import { collide, createManifold } from '../core/collide.js';
import { SleepManager, clampMotion } from '../core/sleep.js';

class ContactRec {
  constructor() {
    this.A = null; this.B = null; this.ref = null;
    this.laAx = 0; this.laAy = 0;    // surface anchor on A, A's local frame
    this.laBx = 0; this.laBy = 0;    // surface anchor on B, B's local frame
    this.lnx = 0; this.lny = 0;      // contact normal in ref body's local frame
    this.pax0 = 0; this.pay0 = 0;    // anchor world positions at substep start
    this.pbx0 = 0; this.pby0 = 0;
    this.nx = 0; this.ny = 0;        // last evaluated world normal (debug/vel pass)
    this.rax = 0; this.ray = 0;      // last evaluated arms
    this.rbx = 0; this.rby = 0;
    this.wx = 0; this.wy = 0;        // last evaluated world contact point
    this.d = 0;                      // last evaluated penetration depth
    this.lambdaN = 0;
    this.lambdaT = 0;
    this.vnPrev = 0;
    this.muS = 0; this.muD = 0; this.restitution = 0;
  }
}

export class World {
  constructor(opts = {}) {
    this.name = 'Substepped XPBD';
    this.bodies = [];
    this.gravity = { x: 0, y: opts.gravity != null ? opts.gravity : -9.81 };

    // 20 is the range the XPBD paper works in. See README: this scene class
    // needs far more than that to hold a marginal structure indefinitely, and
    // the slider goes to 100 so that convergence is visible interactively.
    this.substeps = opts.substeps != null ? opts.substeps : 20;
    this.iterations = opts.iterations != null ? opts.iterations : 1;
    // Compliance in m/N. 0 = perfectly rigid contacts. Exposed because it is
    // XPBD's headline feature: stiffness is a material property, independent of
    // substep count (unlike a PBD stiffness parameter, which is not).
    this.compliance = opts.compliance != null ? opts.compliance : 0;
    // Cap on how fast a contact may push overlapping bodies apart. XPBD turns
    // every positional correction straight into velocity (v = (x - x_prev)/h),
    // so without this a body that starts 40 mm inside another is ejected at
    // 40mm/h = 29 m/s. The effective cap is max(this, |approach speed|), so a
    // genuine fast impact is never damped, and a resting contact — whose
    // per-substep depth is ~g*h^2 — never reaches it. Not in the original
    // paper; standard in production XPBD implementations.
    this.maxRecoverySpeed = opts.maxRecoverySpeed != null ? opts.maxRecoverySpeed : 3.0;
    this.allowSleep = !!opts.allowSleep;

    this.broadphase = new Broadphase();
    this.broadphase.margin = 0.05;
    this.sleepManager = new SleepManager();
    this.manifold = createManifold();

    this.pool = [];
    this.contacts = [];
    this.sleepPairs = [];
    this.time = 0;

    this.stats = {
      bodies: 0, contacts: 0, points: 0, sleeping: 0,
      maxPenetration: 0, avgPenetration: 0, energy: 0,
      broadMs: 0, narrowMs: 0, solveMs: 0, positionMs: 0, totalMs: 0,
      substeps: this.substeps, iterations: this.iterations,
    };
  }

  static get params() {
    return [
      { key: 'substeps', label: 'Substeps / frame', min: 1, max: 40, step: 1 },
      { key: 'iterations', label: 'Iterations / substep', min: 1, max: 10, step: 1 },
      { key: 'compliance', label: 'Contact compliance', min: 0, max: 0.0002, step: 0.000005 },
      { key: 'maxRecoverySpeed', label: 'Max recovery speed (m/s)', min: 0.25, max: 30, step: 0.25 },
    ];
  }

  addBody(b) { this.bodies.push(b); this.broadphase.reset(); return b; }
  removeBody(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); this.broadphase.reset(); }
  clear() { this.bodies.length = 0; this.contacts.length = 0; this.broadphase.reset(); this.time = 0; }
  wakeAll() { SleepManager.wakeAll(this.bodies); }

  step(dt) {
    if (dt <= 0) return;
    const t0 = now();
    this.time += dt;
    const n = Math.max(1, this.substeps | 0);
    const h = dt / n;

    for (const b of this.bodies) b.updateTransform();
    const tb0 = now();
    const nPairs = this.broadphase.update(this.bodies);
    const tb1 = now();

    let narrowMs = 0, solveMs = 0;
    let list = this.contacts;
    for (let s = 0; s < n; s++) {
      this.integrate(h);

      const tn0 = now();
      list = this.buildContacts(nPairs);
      narrowMs += now() - tn0;

      const ts0 = now();
      for (let it = 0; it < this.iterations; it++) this.solvePositions(list, h);
      this.recoverVelocities(h);
      this.solveVelocities(list, h);
      solveMs += now() - ts0;
    }
    this.contacts = list;

    for (const b of this.bodies) b.updateTransform();

    if (this.allowSleep) {
      this.sleepPairs.length = 0;
      for (const c of list) this.sleepPairs.push({ bodyA: c.A, bodyB: c.B });
      this.stats.sleeping = this.sleepManager.update(this.bodies, this.sleepPairs, dt);
    } else {
      this.stats.sleeping = 0;
      for (const b of this.bodies) b.sleeping = false;
    }

    // Constraint error reported is the residual after the final substep.
    let maxPen = 0, sumPen = 0, points = 0, energy = 0;
    for (const c of list) {
      const d = this.evaluateDepth(c);
      points++;
      if (d > 0) { sumPen += d; if (d > maxPen) maxPen = d; }
    }
    for (const b of this.bodies) energy += b.kineticEnergy();

    const st = this.stats;
    st.bodies = this.bodies.length;
    st.contacts = list.length;
    st.points = points;
    st.maxPenetration = maxPen;
    st.avgPenetration = points ? sumPen / points : 0;
    st.energy = energy;
    st.broadMs = tb1 - tb0;
    st.narrowMs = narrowMs;
    st.solveMs = solveMs;
    st.positionMs = 0;
    st.totalMs = now() - t0;
    st.substeps = n;
    st.iterations = this.iterations;
  }

  // -- substep stages --------------------------------------------------------

  /** Explicit ("quasi-explicit") position integration. */
  integrate(h) {
    const g = this.gravity;
    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;
      b.prevPosition.x = b.position.x;
      b.prevPosition.y = b.position.y;
      b.prevAngle = b.angle;

      b.linearVelocity.x += h * (g.x + b.invMass * b.force.x);
      b.linearVelocity.y += h * (g.y + b.invMass * b.force.y);
      b.angularVelocity += h * b.invInertia * b.torque;
      clampMotion(b, h);

      b.position.x += h * b.linearVelocity.x;
      b.position.y += h * b.linearVelocity.y;
      b.angle += h * b.angularVelocity;
      b.updateTransform();
    }
    for (const b of this.bodies) { b.force.x = 0; b.force.y = 0; b.torque = 0; }
  }

  alloc(i) {
    let c = this.pool[i];
    if (!c) { c = new ContactRec(); this.pool[i] = c; }
    return c;
  }

  /** Full narrowphase for this substep. */
  buildContacts(nPairs) {
    const pairs = this.broadphase.pairs;
    const m = this.manifold;
    const out = [];
    let idx = 0;
    for (let i = 0; i < nPairs; i++) {
      const p = pairs[i];
      if (!collide(p.a, p.b, m)) continue;
      const A = m.bodyA, B = m.bodyB;
      const ref = m.refIsB ? B : A;
      const nx = m.normal.x, ny = m.normal.y;
      const muS = Math.sqrt(A.staticFriction * B.staticFriction);
      const muD = Math.sqrt(A.friction * B.friction);
      const rest = Math.max(A.restitution, B.restitution);
      for (let k = 0; k < m.count; k++) {
        const mp = m.points[k];
        // XPBD acts on real overlap only; separated pairs simply have no
        // constraint this substep. With h ~ 1ms the gap cannot be missed.
        if (mp.separation > 0) continue;
        const c = this.alloc(idx++);
        setAnchors(c, A, B, ref, nx, ny, mp.x, mp.y, mp.separation);
        c.muS = muS; c.muD = muD; c.restitution = rest;
        this.beginContact(c);
        out.push(c);
      }
    }
    return out;
  }

  /** Reset per-substep accumulators and snapshot the pre-solve state. */
  beginContact(c) {
    const A = c.A, B = c.B;
    c.lambdaN = 0; c.lambdaT = 0;
    this.evaluateDepth(c);   // fills nx/ny, arms, wx/wy, d

    // Anchor world positions at the start of this substep (before the position
    // solve), which static friction compares against.
    const ca = Math.cos(A.prevAngle), sa = Math.sin(A.prevAngle);
    c.pax0 = A.prevPosition.x + ca * c.laAx - sa * c.laAy;
    c.pay0 = A.prevPosition.y + sa * c.laAx + ca * c.laAy;
    const cb = Math.cos(B.prevAngle), sb = Math.sin(B.prevAngle);
    c.pbx0 = B.prevPosition.x + cb * c.laBx - sb * c.laBy;
    c.pby0 = B.prevPosition.y + sb * c.laBx + cb * c.laBy;

    // Approach speed before the position solve, kept for restitution.
    const vax = A.linearVelocity.x - A.angularVelocity * c.ray;
    const vay = A.linearVelocity.y + A.angularVelocity * c.rax;
    const vbx = B.linearVelocity.x - B.angularVelocity * c.rby;
    const vby = B.linearVelocity.y + B.angularVelocity * c.rbx;
    c.vnPrev = (vax - vbx) * c.nx + (vay - vby) * c.ny;
  }

  /**
   * Re-derive normal, arms and penetration depth from the current poses.
   * Penetration d = (pA - pB) . n, positive when the surfaces have crossed.
   */
  evaluateDepth(c) {
    const A = c.A, B = c.B, R = c.ref;
    const cr = Math.cos(R.angle), sr = Math.sin(R.angle);
    const nx = cr * c.lnx - sr * c.lny;
    const ny = sr * c.lnx + cr * c.lny;
    const ca = Math.cos(A.angle), sa = Math.sin(A.angle);
    const rax = ca * c.laAx - sa * c.laAy, ray = sa * c.laAx + ca * c.laAy;
    const cb = Math.cos(B.angle), sb = Math.sin(B.angle);
    const rbx = cb * c.laBx - sb * c.laBy, rby = sb * c.laBx + cb * c.laBy;
    const pax = A.position.x + rax, pay = A.position.y + ray;
    const pbx = B.position.x + rbx, pby = B.position.y + rby;
    c.nx = nx; c.ny = ny;
    c.rax = rax; c.ray = ray; c.rbx = rbx; c.rby = rby;
    c.wx = 0.5 * (pax + pbx); c.wy = 0.5 * (pay + pby);
    c.pax = pax; c.pay = pay; c.pbx = pbx; c.pby = pby;
    c.d = (pax - pbx) * nx + (pay - pby) * ny;
    return c.d;
  }

  /**
   * One iteration of positional projection.
   *
   *   non-penetration: dLambda = (C - alphaTilde*lambda) / (w_A + w_B + alphaTilde)
   *   static friction: cancel this substep's tangential slip, capped by
   *                    lambda_t <= mu_s * lambda_n  (Coulomb cone at the
   *                    position level)
   */
  solvePositions(list, h) {
    const alphaTilde = this.compliance / (h * h);
    for (const c of list) {
      const A = c.A, B = c.B;
      const d = this.evaluateDepth(c);
      if (d <= 0) continue;
      const nx = c.nx, ny = c.ny;
      const rax = c.rax, ray = c.ray, rbx = c.rbx, rby = c.rby;

      const w = genInvMass(A, rax, ray, nx, ny) + genInvMass(B, rbx, rby, nx, ny);
      if (w <= 0) continue;
      const maxDepth = Math.max(this.maxRecoverySpeed, Math.abs(c.vnPrev)) * h;
      const dEff = d > maxDepth ? maxDepth : d;
      let dLambda = (dEff - alphaTilde * c.lambdaN) / (w + alphaTilde);
      if (dLambda <= 0) continue;
      c.lambdaN += dLambda;
      // Push A along -n and B along +n.
      applyPositional(A, B, rax, ray, rbx, rby, -nx, -ny, dLambda);

      if (c.muS <= 0) continue;

      // --- static friction ---
      // Recompute anchors after the normal push, then measure how far the two
      // contact points have slid past each other during this substep.
      this.evaluateDepth(c);
      let dx = (c.pax - c.pax0) - (c.pbx - c.pbx0);
      let dy = (c.pay - c.pay0) - (c.pby - c.pby0);
      const dn = dx * c.nx + dy * c.ny;
      dx -= dn * c.nx; dy -= dn * c.ny;
      const slip = Math.hypot(dx, dy);
      if (slip < 1e-11) continue;
      const tx = dx / slip, ty = dy / slip;
      const wt = genInvMass(A, c.rax, c.ray, tx, ty) + genInvMass(B, c.rbx, c.rby, tx, ty);
      if (wt <= 0) continue;
      let dLambdaT = slip / wt;
      const maxT = c.muS * c.lambdaN;
      if (c.lambdaT + dLambdaT > maxT) dLambdaT = maxT - c.lambdaT;
      if (dLambdaT <= 0) continue;
      c.lambdaT += dLambdaT;
      applyPositional(A, B, c.rax, c.ray, c.rbx, c.rby, -tx, -ty, dLambdaT);
    }
  }

  /** v = (x - x_prev)/h. Position corrections reappear here as velocity. */
  recoverVelocities(h) {
    const inv = 1 / h;
    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;
      b.linearVelocity.x = (b.position.x - b.prevPosition.x) * inv;
      b.linearVelocity.y = (b.position.y - b.prevPosition.y) * inv;
      b.angularVelocity = (b.angle - b.prevAngle) * inv;
    }
  }

  /** Dynamic friction and restitution as velocity-level impulses. */
  solveVelocities(list, h) {
    const gMag = Math.hypot(this.gravity.x, this.gravity.y);
    for (const c of list) {
      if (c.lambdaN <= 0) continue;
      const A = c.A, B = c.B;
      const rax = c.rax, ray = c.ray, rbx = c.rbx, rby = c.rby;
      const nx = c.nx, ny = c.ny;

      const vx = (A.linearVelocity.x - A.angularVelocity * ray) - (B.linearVelocity.x - B.angularVelocity * rby);
      const vy = (A.linearVelocity.y + A.angularVelocity * rax) - (B.linearVelocity.y + B.angularVelocity * rbx);
      const vn = vx * nx + vy * ny;
      const vtx = vx - vn * nx, vty = vy - vn * ny;
      const vt = Math.hypot(vtx, vty);

      // Dynamic friction: shed tangential speed, capped by mu_d * f_n * h.
      if (vt > 1e-9 && c.muD > 0) {
        const fn = c.lambdaN / (h * h);
        const dv = Math.min(c.muD * fn * h, vt);
        const tx = vtx / vt, ty = vty / vt;
        const wt = genInvMass(A, rax, ray, tx, ty) + genInvMass(B, rbx, rby, tx, ty);
        if (wt > 0) applyVelocity(A, B, rax, ray, rbx, rby, -tx, -ty, dv / wt);
      }

      // Restitution, suppressed below 2*g*h so resting stacks do not buzz.
      if (c.restitution > 0 && c.vnPrev > 2 * gMag * h) {
        const vx2 = (A.linearVelocity.x - A.angularVelocity * ray) - (B.linearVelocity.x - B.angularVelocity * rby);
        const vy2 = (A.linearVelocity.y + A.angularVelocity * rax) - (B.linearVelocity.y + B.angularVelocity * rbx);
        const vnNow = vx2 * nx + vy2 * ny;
        const target = -c.restitution * c.vnPrev;
        if (target < vnNow) {
          const wn = genInvMass(A, rax, ray, nx, ny) + genInvMass(B, rbx, rby, nx, ny);
          if (wn > 0) applyVelocity(A, B, rax, ray, rbx, rby, nx, ny, (target - vnNow) / wn);
        }
      }
    }
  }

  debugContacts() {
    return this.contacts.map((c) => ({
      x: c.wx, y: c.wy, nx: c.nx, ny: c.ny,
      impulse: c.lambdaN, warm: false, separation: -c.d,
    }));
  }
}

// -- helpers -----------------------------------------------------------------

/**
 * Convert a manifold point (midpoint + separation) into the pair of local
 * surface anchors plus the normal in the reference body's frame.
 */
function setAnchors(c, A, B, ref, nx, ny, px, py, separation) {
  c.A = A; c.B = B; c.ref = ref;
  // Surface point on A sits half the separation on the -n side of the midpoint
  // (and vice versa), so that (pA - pB).n reproduces the penetration depth.
  const sax = px - nx * 0.5 * separation, say = py - ny * 0.5 * separation;
  const sbx = px + nx * 0.5 * separation, sby = py + ny * 0.5 * separation;
  const ca = A.cos, sa = A.sin;
  const dax = sax - A.position.x, day = say - A.position.y;
  c.laAx = ca * dax + sa * day; c.laAy = -sa * dax + ca * day;
  const cb = B.cos, sb = B.sin;
  const dbx = sbx - B.position.x, dby = sby - B.position.y;
  c.laBx = cb * dbx + sb * dby; c.laBy = -sb * dbx + cb * dby;
  const cr = ref.cos, sr = ref.sin;
  c.lnx = cr * nx + sr * ny; c.lny = -sr * nx + cr * ny;
}

function genInvMass(b, rx, ry, dx, dy) {
  if (b.isStatic || b.sleeping) return 0;
  const rn = rx * dy - ry * dx;
  return b.invMass + b.invInertia * rn * rn;
}

/** Apply positional impulse `lam` along (dx,dy) to A, and its negation to B. */
function applyPositional(A, B, rax, ray, rbx, rby, dx, dy, lam) {
  const px = lam * dx, py = lam * dy;
  if (!A.isStatic && !A.sleeping) {
    A.position.x += A.invMass * px;
    A.position.y += A.invMass * py;
    A.angle += A.invInertia * (rax * py - ray * px);
  }
  if (!B.isStatic && !B.sleeping) {
    B.position.x -= B.invMass * px;
    B.position.y -= B.invMass * py;
    B.angle -= B.invInertia * (rbx * py - rby * px);
  }
}

function applyVelocity(A, B, rax, ray, rbx, rby, dx, dy, lam) {
  const px = lam * dx, py = lam * dy;
  if (!A.isStatic && !A.sleeping) {
    A.linearVelocity.x += A.invMass * px;
    A.linearVelocity.y += A.invMass * py;
    A.angularVelocity += A.invInertia * (rax * py - ray * px);
  }
  if (!B.isStatic && !B.sleeping) {
    B.linearVelocity.x -= B.invMass * px;
    B.linearVelocity.y -= B.invMass * py;
    B.angularVelocity -= B.invInertia * (rbx * py - rby * px);
  }
}

const now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Number(process.hrtime.bigint() / 1000n) / 1000;
