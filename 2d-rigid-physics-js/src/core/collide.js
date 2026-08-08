// Narrowphase: SAT + Sutherland-Hodgman face clipping producing 2-point
// manifolds for convex polygons, plus circle cases.
//
// Shared verbatim by both engines. Contact points carry a stable feature `id`
// so the sequential-impulse engine can warm-start from the previous frame, and
// so both engines can colour-code persistent vs new contacts in the debug view.
//
// Convention: manifold.normal points from A towards B, and `separation` is
// negative when the shapes overlap.

export const LINEAR_SLOP = 0.005;          // allowed overlap, ~5 mm
export const SPECULATIVE_DISTANCE = 4 * LINEAR_SLOP;

export function createManifold() {
  return {
    bodyA: null,
    bodyB: null,
    normal: { x: 0, y: 0 },
    // Which body owns the reference face. The XPBD engine attaches the contact
    // frame to that body so the normal rotates with the surface that defined it.
    refIsB: false,
    count: 0,
    points: [newPoint(), newPoint()],
  };
}

function newPoint() {
  return {
    x: 0, y: 0,              // world contact position
    // Anchors relative to each centre of mass, refreshed every step.
    rax: 0, ray: 0, rbx: 0, rby: 0,
    separation: 0,
    id: 0,
    // Sequential-impulse solver scratch. XPBD keeps its own per-substep
    // contact records, so nothing here is shared between the two engines.
    normalImpulse: 0,
    tangentImpulse: 0,
    normalMass: 0,
    tangentMass: 0,
    velocityBias: 0,
    relativeVelocity: 0,
    warmStarted: false,
  };
}

function makeId(refFace, incFace, clipIndex, flip) {
  return ((refFace & 0xff) << 24) | ((incFace & 0xff) << 16) | ((clipIndex & 0xff) << 8) | (flip ? 1 : 0);
}

/**
 * Largest separation of polygon B from any face of polygon A.
 * Returns {index, separation} using cached world-space geometry.
 */
function findMaxSeparation(A, B) {
  const nA = A.worldNormals, vA = A.worldVerts;
  const vB = B.worldVerts;
  let bestIndex = 0, bestSep = -Infinity;
  for (let i = 0; i < nA.length; i++) {
    const nx = nA[i].x, ny = nA[i].y;
    const vx = vA[i].x, vy = vA[i].y;
    // Support point of B in direction -n.
    let minDot = Infinity;
    for (let j = 0; j < vB.length; j++) {
      const d = nx * (vB[j].x - vx) + ny * (vB[j].y - vy);
      if (d < minDot) minDot = d;
    }
    if (minDot > bestSep) { bestSep = minDot; bestIndex = i; }
  }
  return { index: bestIndex, separation: bestSep };
}

/** Index of the face of `inc` most anti-parallel to the reference normal. */
function findIncidentFace(inc, nx, ny) {
  const n = inc.worldNormals;
  let best = 0, minDot = Infinity;
  for (let i = 0; i < n.length; i++) {
    const d = nx * n[i].x + ny * n[i].y;
    if (d < minDot) { minDot = d; best = i; }
  }
  return best;
}

const clipA = { x: 0, y: 0, id: 0 };
const clipB = { x: 0, y: 0, id: 0 };
const outA = { x: 0, y: 0, id: 0 };
const outB = { x: 0, y: 0, id: 0 };

/** Clip segment (p0,p1) against the half-space dot(n, p) <= offset. */
function clipSegment(p0, p1, nx, ny, offset, o0, o1) {
  const d0 = nx * p0.x + ny * p0.y - offset;
  const d1 = nx * p1.x + ny * p1.y - offset;
  let count = 0;
  if (d0 <= 0) { o0.x = p0.x; o0.y = p0.y; o0.id = p0.id; count = 1; }
  if (d1 <= 0) {
    const t = count === 0 ? o0 : o1;
    t.x = p1.x; t.y = p1.y; t.id = p1.id; count++;
  }
  if ((d0 > 0) !== (d1 > 0) && count < 2) {
    const t = d0 / (d0 - d1);
    const dst = count === 0 ? o0 : o1;
    dst.x = p0.x + t * (p1.x - p0.x);
    dst.y = p0.y + t * (p1.y - p0.y);
    // The interpolated point inherits the identity of the clipped-away vertex,
    // which is what keeps the id stable while a face slides across an edge.
    dst.id = d0 > 0 ? p0.id : p1.id;
    count++;
  }
  return count;
}

function collidePolygons(A, B, m, maxDist) {
  const sepA = findMaxSeparation(A, B);
  if (sepA.separation > maxDist) return 0;
  const sepB = findMaxSeparation(B, A);
  if (sepB.separation > maxDist) return 0;

  let ref, inc, refIndex, flip;
  // Bias towards keeping A as the reference face to reduce frame-to-frame
  // flip-flopping between two nearly equal axes (which would destroy warm starts).
  if (sepB.separation > sepA.separation + 0.1 * LINEAR_SLOP) {
    ref = B; inc = A; refIndex = sepB.index; flip = true;
  } else {
    ref = A; inc = B; refIndex = sepA.index; flip = false;
  }

  const rn = ref.worldNormals[refIndex];
  const nx = rn.x, ny = rn.y;
  const rv = ref.worldVerts;
  const i1 = refIndex, i2 = (refIndex + 1) % rv.length;
  const r1 = rv[i1], r2 = rv[i2];
  // Reference face tangent, pointing from r1 to r2. Face normals are built as
  // n = perp(edge) = (ey, -ex)/|e|, so the edge direction is (-ny, nx). Getting
  // this sign wrong swaps the two clip planes and every manifold comes back empty.
  const tx = -ny, ty = nx;

  const incIndex = findIncidentFace(inc, nx, ny);
  const iv = inc.worldVerts;
  const j1 = incIndex, j2 = (incIndex + 1) % iv.length;
  clipA.x = iv[j1].x; clipA.y = iv[j1].y; clipA.id = 0;
  clipB.x = iv[j2].x; clipB.y = iv[j2].y; clipB.id = 1;

  // Clip against the two side planes of the reference face.
  const lower = tx * r1.x + ty * r1.y;
  const upper = tx * r2.x + ty * r2.y;
  let n1 = clipSegment(clipA, clipB, -tx, -ty, -lower, outA, outB);
  if (n1 < 2) return 0;
  clipA.x = outA.x; clipA.y = outA.y; clipA.id = outA.id;
  clipB.x = outB.x; clipB.y = outB.y; clipB.id = outB.id;
  n1 = clipSegment(clipA, clipB, tx, ty, upper, outA, outB);
  if (n1 < 2) return 0;

  const refOffset = nx * r1.x + ny * r1.y;
  let count = 0;
  const src = [outA, outB];
  for (let k = 0; k < 2; k++) {
    const s = nx * src[k].x + ny * src[k].y - refOffset;
    if (s <= maxDist) {
      const p = m.points[count];
      // Report the point midway between the two surfaces. Using the same world
      // point for both bodies keeps the impulse arms consistent.
      p.x = src[k].x - 0.5 * s * nx;
      p.y = src[k].y - 0.5 * s * ny;
      p.separation = s;
      p.id = makeId(refIndex, incIndex, src[k].id, flip);
      count++;
    }
  }
  if (count === 0) return 0;

  if (flip) { m.normal.x = -nx; m.normal.y = -ny; }
  else { m.normal.x = nx; m.normal.y = ny; }
  m.refIsB = flip;
  return count;
}

function collideCircles(A, B, m, maxDist) {
  const dx = B.position.x - A.position.x;
  const dy = B.position.y - A.position.y;
  const rSum = A.shape.radius + B.shape.radius;
  const d = Math.hypot(dx, dy);
  const sep = d - rSum;
  if (sep > maxDist) return 0;
  m.refIsB = false;
  let nx, ny;
  if (d > 1e-9) { nx = dx / d; ny = dy / d; } else { nx = 0; ny = 1; }
  m.normal.x = nx; m.normal.y = ny;
  const p = m.points[0];
  const ax = A.position.x + nx * A.shape.radius;
  const bx = B.position.x - nx * B.shape.radius;
  const ay = A.position.y + ny * A.shape.radius;
  const by = B.position.y - ny * B.shape.radius;
  p.x = 0.5 * (ax + bx); p.y = 0.5 * (ay + by);
  p.separation = sep;
  p.id = 0;
  return 1;
}

/** Polygon A vs circle B. Normal points from the polygon towards the circle. */
function collidePolygonCircle(A, B, m, maxDist) {
  const c = B.position, r = B.shape.radius;
  const vA = A.worldVerts, nA = A.worldNormals;
  const n = vA.length;

  let bestIndex = 0, bestSep = -Infinity;
  for (let i = 0; i < n; i++) {
    const s = nA[i].x * (c.x - vA[i].x) + nA[i].y * (c.y - vA[i].y);
    if (s > bestSep) { bestSep = s; bestIndex = i; }
  }
  if (bestSep > r + maxDist) return 0;
  m.refIsB = false;

  const i1 = bestIndex, i2 = (bestIndex + 1) % n;
  const v1 = vA[i1], v2 = vA[i2];
  let nx, ny, sep;

  if (bestSep < 1e-9) {
    // Centre is inside the polygon: use the least-penetrating face.
    nx = nA[bestIndex].x; ny = nA[bestIndex].y;
    sep = bestSep - r;
  } else {
    // Voronoi region test against the best face's endpoints.
    const ex = v2.x - v1.x, ey = v2.y - v1.y;
    const u = ((c.x - v1.x) * ex + (c.y - v1.y) * ey) / (ex * ex + ey * ey);
    let px, py;
    if (u <= 0) { px = v1.x; py = v1.y; }
    else if (u >= 1) { px = v2.x; py = v2.y; }
    else { px = v1.x + u * ex; py = v1.y + u * ey; }
    const dx = c.x - px, dy = c.y - py;
    const d = Math.hypot(dx, dy);
    if (d > 1e-9) { nx = dx / d; ny = dy / d; } else { nx = nA[bestIndex].x; ny = nA[bestIndex].y; }
    sep = d - r;
    if (sep > maxDist) return 0;
  }

  m.normal.x = nx; m.normal.y = ny;
  const p = m.points[0];
  p.x = c.x - nx * (r + 0.5 * sep);
  p.y = c.y - ny * (r + 0.5 * sep);
  p.separation = sep;
  p.id = bestIndex;
  return 1;
}

/**
 * Fill `m` with the contact manifold between A and B.
 * Returns the number of contact points (0, 1 or 2). `m.bodyA`/`m.bodyB` are set
 * so the normal always points from bodyA to bodyB.
 *
 * `maxDist` is how far apart the surfaces may be and still report a contact.
 * The sequential-impulse engine widens it by the pair's closing distance over
 * the step, which combined with the speculative velocity bias stops moderately
 * fast bodies at the surface instead of letting them pass through it.
 */
export function collide(A, B, m, maxDist = SPECULATIVE_DISTANCE) {
  const ta = A.shape.type, tb = B.shape.type;
  let count;
  if (ta === 'poly' && tb === 'poly') {
    m.bodyA = A; m.bodyB = B;
    count = collidePolygons(A, B, m, maxDist);
  } else if (ta === 'circle' && tb === 'circle') {
    m.bodyA = A; m.bodyB = B;
    count = collideCircles(A, B, m, maxDist);
  } else if (ta === 'poly') {
    m.bodyA = A; m.bodyB = B;
    count = collidePolygonCircle(A, B, m, maxDist);
  } else {
    // Circle vs polygon: swap so the polygon is the reference, then flip.
    m.bodyA = B; m.bodyB = A;
    count = collidePolygonCircle(B, A, m, maxDist);
  }
  m.count = count;
  return count;
}

/** Refresh the contact anchors from the current body poses. */
export function updateAnchors(m) {
  const A = m.bodyA, B = m.bodyB;
  for (let i = 0; i < m.count; i++) {
    const p = m.points[i];
    p.rax = p.x - A.position.x; p.ray = p.y - A.position.y;
    p.rbx = p.x - B.position.x; p.rby = p.y - B.position.y;
  }
}
