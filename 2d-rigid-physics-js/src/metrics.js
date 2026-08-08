// Scene-level measurements shared by the browser HUD and the headless bench.
// These are the numbers the evaluation in README.md is built from.

export function measure(world) {
  let apex = -Infinity;
  let maxDisp = 0, sumDisp = 0, n = 0;
  let moving = 0, energy = 0;
  let trackedApex = -Infinity;
  for (const b of world.bodies) {
    if (b.isStatic) continue;
    n++;
    const dx = b.position.x - b.initialPosition.x;
    const dy = b.position.y - b.initialPosition.y;
    const d = Math.hypot(dx, dy);
    sumDisp += d;
    if (d > maxDisp) maxDisp = d;
    if (b.position.y > apex) apex = b.position.y;
    if (b.tracked && b.position.y > trackedApex) trackedApex = b.position.y;
    const v = b.linearVelocity;
    if (v.x * v.x + v.y * v.y > 0.01 || Math.abs(b.angularVelocity) > 0.2) moving++;
    energy += b.kineticEnergy();
  }
  return {
    apexHeight: apex === -Infinity ? 0 : apex,
    trackedHeight: trackedApex === -Infinity ? 0 : trackedApex,
    maxDisplacement: maxDisp,
    avgDisplacement: n ? sumDisp / n : 0,
    movingBodies: moving,
    dynamicBodies: n,
    energy,
    maxPenetration: world.stats.maxPenetration,
    avgPenetration: world.stats.avgPenetration,
    contacts: world.stats.contacts,
    points: world.stats.points,
  };
}

/**
 * A cheap order-sensitive hash of the whole world state. Two runs that agree on
 * this are bit-identical, which is how the determinism check works.
 */
export function stateHash(world) {
  let h = 2166136261 >>> 0;
  const buf = new Float64Array(1);
  const view = new Uint32Array(buf.buffer);
  const mix = (x) => {
    buf[0] = x;
    h ^= view[0]; h = Math.imul(h, 16777619) >>> 0;
    h ^= view[1]; h = Math.imul(h, 16777619) >>> 0;
  };
  for (const b of world.bodies) {
    mix(b.position.x); mix(b.position.y); mix(b.angle);
    mix(b.linearVelocity.x); mix(b.linearVelocity.y); mix(b.angularVelocity);
  }
  return h >>> 0;
}
