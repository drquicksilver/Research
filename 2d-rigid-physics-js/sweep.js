#!/usr/bin/env node
// Convergence sweeps: how much solver work does each engine need before the
// marginally-stable scenes actually stand up? This produces the convergence
// tables in README.md.
//
//   node sweep.js [scene]

import { World as SIWorld } from './src/engines/si.js';
import { World as XPBDWorld } from './src/engines/xpbd.js';
import { buildScene } from './src/scenes.js';
import { measure } from './src/metrics.js';

const DT = 1 / 60, SECONDS = 8;
const scene = process.argv[2] || 'houseOfCards';

function trial(make) {
  const w = make();
  buildScene(w, scene);
  const apex0 = measure(w).apexHeight;
  let ms = 0;
  const steps = Math.round(SECONDS / DT);
  for (let i = 0; i < steps; i++) {
    const t = process.hrtime.bigint();
    w.step(DT);
    ms += Number(process.hrtime.bigint() - t) / 1e6;
  }
  const m = measure(w);
  return {
    drop: (apex0 - m.apexHeight) * 1000,
    displ: m.maxDisplacement * 1000,
    pen: w.stats.maxPenetration * 1000,
    ms: ms / steps,
    standing: (apex0 - m.apexHeight) < 0.05,
  };
}

const row = (label, r) =>
  `${label.padEnd(30)} ${(r.standing ? 'STANDS  ' : 'collapses')} ` +
  `apex drop ${r.drop.toFixed(1).padStart(8)} mm   max displ ${r.displ.toFixed(1).padStart(8)} mm   ` +
  `pen ${r.pen.toFixed(3).padStart(6)} mm   ${r.ms.toFixed(3).padStart(7)} ms/step`;

console.log(`\nscene "${scene}", ${SECONDS}s, dt=1/60, no perturbation\n`);
console.log('--- XPBD: substeps x iterations ---');
for (const substeps of [4, 8, 12, 20, 40, 60, 100, 150, 200, 300]) {
  console.log(row(`  substeps=${substeps} it=1`, trial(() => new XPBDWorld({ substeps, iterations: 1 }))));
}
for (const iterations of [2, 4]) {
  for (const substeps of [4, 8, 12]) {
    console.log(row(`  substeps=${substeps} it=${iterations}`, trial(() => new XPBDWorld({ substeps, iterations }))));
  }
}

console.log('\n--- Sequential impulses: velocity x position iterations ---');
for (const vi of [1, 2, 4, 8, 16, 32]) {
  console.log(row(`  velIt=${vi} posIt=3`, trial(() => new SIWorld({ velocityIterations: vi, positionIterations: 3 }))));
}
for (const pi of [0, 1, 2, 6]) {
  console.log(row(`  velIt=8 posIt=${pi}`, trial(() => new SIWorld({ velocityIterations: 8, positionIterations: pi }))));
}
console.log(row('  defaults, no warm start', trial(() => new SIWorld({ warmStarting: false }))));
console.log(row('  defaults, no block solver', trial(() => new SIWorld({ blockSolver: false }))));
console.log(row('  defaults, neither', trial(() => new SIWorld({ warmStarting: false, blockSolver: false }))));
console.log(row('  defaults, no speculative CCD', trial(() => new SIWorld({ continuous: false }))));
console.log('');
