// Island detection and sleeping. Shared by both engines so that the sleep
// behaviour never becomes a confounding variable in the comparison.
//
// Bodies are grouped into islands by union-find over the active contact graph.
// An island sleeps only when *every* dynamic body in it has been below the
// velocity thresholds for `sleepTime` seconds; otherwise one twitching card at
// the top of a tower would leave the rest of the structure frozen underneath it.

export const SLEEP_LINEAR = 0.04;    // m/s
export const SLEEP_ANGULAR = 0.12;   // rad/s
export const SLEEP_TIME = 0.5;       // s below threshold before sleeping

export class SleepManager {
  constructor() {
    this.parent = new Map();
    this.canSleep = new Map();
  }

  find(x) {
    const p = this.parent;
    let r = x;
    while (p.get(r) !== r) r = p.get(r);
    while (p.get(x) !== r) { const n = p.get(x); p.set(x, r); x = n; }
    return r;
  }

  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  /**
   * @param bodies    all bodies in the world
   * @param contacts  iterable of {bodyA, bodyB} that are actually touching
   * @param dt        step time
   * @returns number of sleeping dynamic bodies
   */
  update(bodies, contacts, dt) {
    this.parent.clear();
    this.canSleep.clear();
    for (const b of bodies) if (!b.isStatic) this.parent.set(b.id, b.id);

    for (const c of contacts) {
      const a = c.bodyA, b = c.bodyB;
      if (a.isStatic || b.isStatic) continue;
      this.union(a.id, b.id);
    }

    // Per-body sleep timer.
    for (const b of bodies) {
      if (b.isStatic) continue;
      const v = b.linearVelocity;
      const quiet = (v.x * v.x + v.y * v.y) < SLEEP_LINEAR * SLEEP_LINEAR &&
                    Math.abs(b.angularVelocity) < SLEEP_ANGULAR;
      b.sleepTime = quiet ? b.sleepTime + dt : 0;
    }

    // An island can sleep only if every member can.
    for (const b of bodies) {
      if (b.isStatic) continue;
      const root = this.find(b.id);
      const ok = b.sleepTime >= SLEEP_TIME;
      if (!this.canSleep.has(root)) this.canSleep.set(root, ok);
      else if (!ok) this.canSleep.set(root, false);
    }

    let sleeping = 0;
    for (const b of bodies) {
      if (b.isStatic) continue;
      const ok = this.canSleep.get(this.find(b.id));
      if (ok) {
        b.sleeping = true;
        b.linearVelocity.x = 0; b.linearVelocity.y = 0; b.angularVelocity = 0;
        sleeping++;
      } else {
        b.sleeping = false;
      }
    }
    return sleeping;
  }

  /** Wake everything (used when the user drags, spawns or perturbs). */
  static wakeAll(bodies) { for (const b of bodies) { b.sleeping = false; b.sleepTime = 0; } }
}

/**
 * Safety clamp on per-step motion. Without it a single bad contact can throw a
 * body across the world and the broadphase misses everything on the way.
 */
export const MAX_TRANSLATION = 2.0;    // metres per step
export const MAX_ROTATION = 0.5 * Math.PI; // radians per step

export function clampMotion(b, dt) {
  const v = b.linearVelocity;
  const t = dt * Math.hypot(v.x, v.y);
  if (t > MAX_TRANSLATION) {
    const s = MAX_TRANSLATION / t;
    v.x *= s; v.y *= s;
  }
  const r = dt * Math.abs(b.angularVelocity);
  if (r > MAX_ROTATION) b.angularVelocity *= MAX_ROTATION / r;
}
