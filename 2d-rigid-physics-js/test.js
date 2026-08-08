#!/usr/bin/env node
// Correctness checks. These are the regression tests that were actually used
// while debugging the two solvers; they encode the physics facts that must hold
// regardless of which solver is running.
//
//   node test.js

import { World as SIWorld } from './src/engines/si.js';
import { World as XPBDWorld } from './src/engines/xpbd.js';
import { makeBox, makeCircle, makeStaticBox, resetBodyIds, Body, boxShape, STATIC } from './src/core/body.js';
import { buildScene, sceneKeys } from './src/scenes.js';
import { collide, createManifold } from './src/core/collide.js';
import { measure } from './src/metrics.js';

const DT = 1 / 60;
let failures = 0, checks = 0;

function check(name, cond, detail = '') {
  checks++;
  if (!cond) { failures++; console.log(`  FAIL  ${name}  ${detail}`); }
  else console.log(`  ok    ${name}  ${detail}`);
}

function engines() {
  return [['si', () => new SIWorld()], ['xpbd', () => new XPBDWorld()]];
}

function run(world, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) world.step(DT);
  return world;
}

console.log('\n== 1. single box comes to rest on the ground ==');
for (const [name, make] of engines()) {
  const w = make();
  resetBodyIds();
  w.addBody(makeStaticBox(0, -0.5, 5, 0.5, { friction: 0.7 }));
  const b = w.addBody(makeBox(0, 0.4, 0.15, 0.15, { friction: 0.7 }));
  run(w, 2);
  check(`${name}: resting height`, Math.abs(b.position.y - 0.15) < 0.01,
        `y=${b.position.y.toFixed(5)} (want 0.150)`);
  check(`${name}: at rest`, Math.hypot(b.linearVelocity.x, b.linearVelocity.y) < 0.02,
        `|v|=${Math.hypot(b.linearVelocity.x, b.linearVelocity.y).toFixed(5)}`);
  check(`${name}: no spin`, Math.abs(b.angularVelocity) < 0.02, `w=${b.angularVelocity.toFixed(5)}`);
}

console.log('\n== 2. two-box stack does not sink ==');
for (const [name, make] of engines()) {
  const w = make();
  resetBodyIds();
  w.addBody(makeStaticBox(0, -0.5, 5, 0.5, { friction: 0.7 }));
  const a = w.addBody(makeBox(0, 0.15, 0.15, 0.15, { friction: 0.7 }));
  const b = w.addBody(makeBox(0, 0.45, 0.15, 0.15, { friction: 0.7 }));
  run(w, 3);
  check(`${name}: lower box height`, Math.abs(a.position.y - 0.15) < 0.01, `y=${a.position.y.toFixed(5)}`);
  check(`${name}: upper box height`, Math.abs(b.position.y - 0.45) < 0.015, `y=${b.position.y.toFixed(5)}`);
}

console.log('\n== 3. free fall: integration bias should be g*h*T/2 for effective step h ==');
// Symplectic Euler lags the exact solution by g*h*T/2. This is the cleanest
// measurement of what substepping buys: XPBD's effective step is dt/substeps,
// so its integration error is smaller by exactly that factor.
for (const [name, make] of engines()) {
  const w = make();
  resetBodyIds();
  const b = w.addBody(makeBox(0, 50, 0.15, 0.15));
  const hEff = name === 'xpbd' ? DT / w.substeps : DT;
  run(w, 1);
  const exact = 50 - 0.5 * 9.81 * 1 * 1;
  const err = exact - b.position.y;
  const predicted = 9.81 * hEff * 1 / 2;
  check(`${name}: lag = g*h*T/2`, Math.abs(err - predicted) < 0.05 * predicted + 1e-9,
        `lag=${(err * 1000).toFixed(2)} mm, predicted ${(predicted * 1000).toFixed(2)} mm`);
}

console.log('\n== 4. Coulomb friction threshold on a 25 deg ramp ==');
// Theory: a block slides iff mu < tan(theta). tan(25 deg) = 0.4663.
for (const [name, make] of engines()) {
  for (const mu of [0.2, 0.4, 0.6, 0.8]) {
    const w = make();
    resetBodyIds();
    const ang = 25 * Math.PI / 180;
    w.addBody(new Body({ shape: boxShape(1.2, 0.05), x: 0, y: 1.0, angle: ang, type: STATIC, friction: mu }));
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const bh = 0.12;
    const b = w.addBody(makeBox(nx * (0.05 + bh + 0.001), 1.0 + ny * (0.05 + bh + 0.001), bh, bh,
                                { angle: ang, friction: mu }));
    const x0 = b.position.x, y0 = b.position.y;
    run(w, 2.5);
    const slid = Math.hypot(b.position.x - x0, b.position.y - y0);
    const shouldSlide = mu < Math.tan(ang);
    check(`${name}: mu=${mu.toFixed(2)} ${shouldSlide ? 'slides' : 'holds'}`,
          shouldSlide ? slid > 0.15 : slid < 0.02, `moved ${(slid * 1000).toFixed(1)} mm`);
  }
}

console.log('\n== 5. restitution: a ball bounces to roughly e^2 of its drop height ==');
for (const [name, make] of engines()) {
  const w = make();
  resetBodyIds();
  w.addBody(makeStaticBox(0, -0.5, 5, 0.5, { friction: 0.5, restitution: 0.8 }));
  const b = w.addBody(makeCircle(0, 1.0 + 0.1, 0.1, { restitution: 0.8, friction: 0.1 }));
  let peak = 0, bounced = false;
  for (let i = 0; i < Math.round(2.5 / DT); i++) {
    w.step(DT);
    if (b.linearVelocity.y > 0) bounced = true;
    if (bounced && b.linearVelocity.y <= 0 && peak === 0) peak = b.position.y - 0.1;
  }
  // e = 0.8 -> apex ~ 0.64 m. Solvers lose some, so accept a broad band.
  check(`${name}: bounce apex`, peak > 0.40 && peak < 0.75, `apex=${peak.toFixed(3)} m (ideal 0.64)`);
}

console.log('\n== 6. momentum is conserved in a head-on collision (e = 1) ==');
for (const [name, make] of engines()) {
  const w = make();
  resetBodyIds();
  const a = w.addBody(makeBox(-1, 5, 0.2, 0.2, { restitution: 1, friction: 0, vx: 3 }));
  const b = w.addBody(makeBox(1, 5, 0.2, 0.2, { restitution: 1, friction: 0, vx: -3 }));
  w.gravity.y = 0;
  const p0 = a.mass * a.linearVelocity.x + b.mass * b.linearVelocity.x;
  run(w, 1.5);
  const p1 = a.mass * a.linearVelocity.x + b.mass * b.linearVelocity.x;
  check(`${name}: momentum`, Math.abs(p1 - p0) < 1e-6, `p0=${p0.toFixed(6)} p1=${p1.toFixed(6)}`);
  check(`${name}: bodies separated`, a.linearVelocity.x < -0.5 && b.linearVelocity.x > 0.5,
        `va=${a.linearVelocity.x.toFixed(3)} vb=${b.linearVelocity.x.toFixed(3)}`);
}

console.log('\n== 7. tunnelling threshold: fastest body a 40 mm wall still stops ==');
// Neither engine implements true swept CCD. The SI engine widens contact
// detection by the pair's closing distance and relies on the speculative
// velocity bias; XPBD relies on its substeps being short enough that the body
// cannot cross the wall within one. Both have a finite threshold; this measures
// it rather than asserting a binary pass.
for (const [name, make] of engines()) {
  let lo = 1, hi = 400;
  const stops = (speed) => {
    const w = make();
    resetBodyIds();
    w.gravity.y = 0;
    w.addBody(makeStaticBox(0, 0, 0.02, 2, { friction: 0.3 }));
    const b = w.addBody(makeCircle(-3, 0, 0.1, { vx: speed, restitution: 0 }));
    for (let i = 0; i < Math.round(0.5 / DT); i++) w.step(DT);
    return b.position.x < 0.05;
  };
  if (!stops(lo)) { check(`${name}: stops a 1 m/s body`, false); continue; }
  for (let i = 0; i < 12; i++) { const mid = 0.5 * (lo + hi); if (stops(mid)) lo = mid; else hi = mid; }
  const perStep = lo * DT;
  check(`${name}: tunnelling threshold`, lo > 8,
        `stops up to ${lo.toFixed(1)} m/s (${(perStep * 1000).toFixed(0)} mm of travel per 1/60 s step)`);
}

console.log('\n== 7b. no scene starts interpenetrated ==');
// A scene that begins inside itself measures the solver's recovery from a bad
// state, not its stacking quality — and the failure looks exactly like a solver
// bug. This check caught two separate layout errors in the house of cards.
{
  const m = createManifold();
  for (const key of sceneKeys) {
    const w = new SIWorld();
    buildScene(w, key);
    let worst = 0, pair = null;
    for (let i = 0; i < w.bodies.length; i++) {
      for (let j = i + 1; j < w.bodies.length; j++) {
        const a = w.bodies[i], b = w.bodies[j];
        if (a.isStatic && b.isStatic) continue;
        if (!collide(a, b, m)) continue;
        for (let k = 0; k < m.count; k++) {
          if (m.points[k].separation < worst) { worst = m.points[k].separation; pair = [a.id, b.id]; }
        }
      }
    }
    check(`scene ${key}`, worst > -0.001,
          `worst initial overlap ${(-worst * 1000).toFixed(3)} mm${pair ? ` (bodies ${pair})` : ''}`);
  }
}

console.log('\n== 8. house of cards stands unaided for 5 s (given enough solver work) ==');
// The configurations differ because the engines need very different amounts of
// work on this scene — that difference is itself one of the headline results.
// See README: XPBD's drift rate on a marginally stable structure falls off with
// the substep size, so it needs ~200 substeps where SI needs 16 iterations.
for (const [name, make] of [['si', () => new SIWorld()],
                            ['xpbd (20 substeps, default)', () => new XPBDWorld()],
                            ['xpbd (200 substeps)', () => new XPBDWorld({ substeps: 200 })]]) {
  const w = make();
  buildScene(w, 'houseOfCards');
  const before = measure(w).apexHeight;
  run(w, 5);
  const m = measure(w);
  const drop = before - m.apexHeight;
  const expectStanding = name !== 'xpbd (20 substeps, default)';
  check(`${name}: ${expectStanding ? 'stands' : 'drifts and falls (documented)'}`,
        expectStanding ? drop < 0.05 : drop > 0.3,
        `apex moved ${(drop * 1000).toFixed(1)} mm, max displacement ${(m.maxDisplacement * 1000).toFixed(1)} mm, ` +
        `max overlap ${(w.stats.maxPenetration * 1000).toFixed(2)} mm`);
}

console.log('\n== 9. a kicked house of cards actually collapses ==');
for (const [name, make] of [['si', () => new SIWorld()], ['xpbd', () => new XPBDWorld({ substeps: 200 })]]) {
  const w = make();
  const s = buildScene(w, 'houseOfCards');
  const before = measure(w).apexHeight;
  run(w, 1);
  s.perturb(w);
  run(w, 3);
  const m = measure(w);
  check(`${name}: collapsed`, before - m.apexHeight > 0.3,
        `apex dropped ${((before - m.apexHeight) * 1000).toFixed(0)} mm`);
}

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
