#!/usr/bin/env node
// Headless benchmark. Runs every scene through both engines with a fixed
// timestep and identical initial conditions, and reports the numbers used in
// README.md. Usage:
//
//   node bench.js                 # full table
//   node bench.js --scene tower   # one scene
//   node bench.js --seconds 6
//   node bench.js --json out.json

import { World as SIWorld } from './src/engines/si.js';
import { World as XPBDWorld } from './src/engines/xpbd.js';
import { scenes, sceneKeys, buildScene } from './src/scenes.js';
import { measure, stateHash } from './src/metrics.js';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name) => argv.includes('--' + name);

const SECONDS = parseFloat(arg('seconds', '5'));
const DT = 1 / 60;
const PERTURB_AT = parseFloat(arg('perturb', '-1')); // seconds, <0 = never
const only = arg('scene', null);
const keys = only ? [only] : sceneKeys;

const engines = {
  si: (o) => new SIWorld(o),
  xpbd: (o) => new XPBDWorld(o),
};

function run(engineKey, sceneKey, opts = {}) {
  const world = engines[engineKey](opts);
  buildScene(world, sceneKey);
  const steps = Math.round(SECONDS / DT);
  const perturbStep = PERTURB_AT >= 0 ? Math.round(PERTURB_AT / DT) : -1;

  let totalMs = 0, worstMs = 0;
  let peakPen = 0, penSum = 0, penN = 0;
  const series = [];

  for (let i = 0; i < steps; i++) {
    if (i === perturbStep) scenes[sceneKey].perturb(world);
    const t0 = process.hrtime.bigint();
    world.step(DT);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    totalMs += ms;
    if (i > 5 && ms > worstMs) worstMs = ms;

    const p = world.stats.maxPenetration;
    if (p > peakPen) peakPen = p;
    penSum += p; penN++;
    if (i % 6 === 0) {
      const m = measure(world);
      series.push({ t: +(i * DT).toFixed(3), pen: +p.toFixed(6), energy: +m.energy.toFixed(4), apex: +m.apexHeight.toFixed(4), moving: m.movingBodies });
    }
  }

  const m = measure(world);
  return {
    engine: engineKey,
    scene: sceneKey,
    bodies: world.bodies.length,
    contacts: world.stats.contacts,
    points: world.stats.points,
    msPerStep: totalMs / steps,
    worstMs,
    peakPenetration: peakPen,
    meanPenetration: penSum / penN,
    finalPenetration: world.stats.maxPenetration,
    apexHeight: m.apexHeight,
    apexDrop: null,     // filled by caller
    maxDisplacement: m.maxDisplacement,
    avgDisplacement: m.avgDisplacement,
    movingBodies: m.movingBodies,
    energy: m.energy,
    hash: stateHash(world),
    breakdown: {
      broad: world.stats.broadMs, narrow: world.stats.narrowMs,
      solve: world.stats.solveMs, position: world.stats.positionMs,
    },
    series,
  };
}

function initialApex(sceneKey) {
  const w = new SIWorld();
  buildScene(w, sceneKey);
  return measure(w).apexHeight;
}

const results = [];
for (const key of keys) {
  if (!scenes[key]) { console.error('unknown scene', key); process.exit(1); }
  const a0 = initialApex(key);
  for (const e of ['si', 'xpbd']) {
    const r = run(e, key);
    r.apexDrop = a0 - r.apexHeight;
    results.push(r);
  }
}

const pad = (s, n) => String(s).padEnd(n);
const num = (x, d = 3, n = 9) => String(x.toFixed(d)).padStart(n);

console.log(`\n${SECONDS.toFixed(1)} s of simulation at dt = 1/60${PERTURB_AT >= 0 ? `, perturbed at t = ${PERTURB_AT}s` : ''}\n`);
console.log(pad('scene', 22) + pad('engine', 8) + '  bodies' + '   ms/step' + '  worst ms' + '   peak pen' + '   mean pen' + '  apex drop' + '   max displ' + '    moving');
console.log('-'.repeat(120));
for (const r of results) {
  console.log(
    pad(r.scene, 22) + pad(r.engine, 8) +
    String(r.bodies).padStart(8) +
    num(r.msPerStep, 3, 10) +
    num(r.worstMs, 3, 10) +
    num(r.peakPenetration * 1000, 2, 11) + '' +
    num(r.meanPenetration * 1000, 2, 12) +
    num(r.apexDrop * 1000, 1, 11) +
    num(r.maxDisplacement * 1000, 1, 12) +
    String(r.movingBodies).padStart(10));
}
console.log('\npenetration / drop / displacement in mm\n');

// Determinism: re-run one scene and compare the state hash.
const detScene = keys[0];
for (const e of ['si', 'xpbd']) {
  const a = run(e, detScene).hash, b = run(e, detScene).hash;
  console.log(`determinism  ${pad(e, 6)} ${detScene}: ${a === b ? 'identical' : 'DIVERGED'} (${a} vs ${b})`);
}

const jsonPath = arg('json', null);
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ seconds: SECONDS, dt: DT, perturbAt: PERTURB_AT, results }, null, 1));
  console.log(`\nwrote ${jsonPath}`);
}
