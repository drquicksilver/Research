// Sweep-and-prune broadphase on the x axis.
//
// Bodies are kept in a persistently sorted array and re-sorted with insertion
// sort each frame, which is close to O(n) given frame-to-frame coherence. Pairs
// are reported with the lower body id first so the pair key is stable, which
// matters for warm starting.

export class Broadphase {
  constructor() {
    this.sorted = [];
    this.pairs = [];
    this.pairCount = 0;
    this.margin = 0;   // constant AABB inflation
    // When set, each body's AABB is additionally inflated by dt*|v| so that a
    // fast body's pair is reported before it has already passed through.
    this.motionDt = 0;
  }

  /**
   * Drop the persistent ordering. MUST be called whenever the world's body set
   * changes: the sorted array holds body references, and a length check alone
   * is not enough — replacing a scene with another of the same size would
   * otherwise leave the broadphase simulating the previous scene's bodies while
   * the renderer drew the new ones.
   */
  reset() { this.sorted.length = 0; }

  /** @param {Body[]} bodies */
  update(bodies) {
    if (this.sorted.length !== bodies.length) this.sorted = bodies.slice();

    const arr = this.sorted;
    // Insertion sort by AABB min x (nearly sorted from the previous frame).
    for (let i = 1; i < arr.length; i++) {
      const b = arr[i];
      const key = b.aabb.minX;
      let j = i - 1;
      while (j >= 0 && arr[j].aabb.minX > key) { arr[j + 1] = arr[j]; j--; }
      arr[j + 1] = b;
    }

    const base = this.margin, mdt = this.motionDt;
    // Sorting uses the un-inflated min x, so the sweep must terminate on the
    // widest possible inflation rather than each body's own.
    let maxMotion = 0;
    if (mdt > 0) {
      for (const b of arr) {
        const v = mdt * Math.hypot(b.linearVelocity.x, b.linearVelocity.y);
        if (v > maxMotion) maxMotion = v;
      }
    }
    this.pairCount = 0;
    const pairs = this.pairs;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      const m = base + (mdt > 0 ? mdt * Math.hypot(a.linearVelocity.x, a.linearVelocity.y) : 0);
      const aMaxX = a.aabb.maxX + m;
      const aMinY = a.aabb.minY - m, aMaxY = a.aabb.maxY + m;
      const aStatic = a.isStatic;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (b.aabb.minX - base - maxMotion > aMaxX) break;   // sweep can stop here
        if (aStatic && b.isStatic) continue;
        if (a.sleeping && b.sleeping) continue;
        if (a.sleeping && b.isStatic) continue;
        if (b.sleeping && aStatic) continue;
        const mb = base + (mdt > 0 ? mdt * Math.hypot(b.linearVelocity.x, b.linearVelocity.y) : 0);
        if (b.aabb.maxX + mb < a.aabb.minX - m) continue;
        if (b.aabb.maxY + mb < aMinY || b.aabb.minY - mb > aMaxY) continue;
        const p = pairs[this.pairCount] || (pairs[this.pairCount] = { a: null, b: null, key: 0 });
        if (a.id < b.id) { p.a = a; p.b = b; } else { p.a = b; p.b = a; }
        // Pair key: ids are < 2^20 in every scene we build, so this is exact.
        p.key = p.a.id * 1048576 + p.b.id;
        this.pairCount++;
      }
    }
    return this.pairCount;
  }
}
