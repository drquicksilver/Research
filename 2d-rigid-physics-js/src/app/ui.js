// The interactive harness: fixed-timestep loop, controls, HUD, mouse handling.
// Engine-agnostic — it only touches the World API that both engines implement,
// so the two pages are identical apart from which solver is compiled in.

import { Renderer, Strip } from './renderer.js';
import { scenes, sceneKeys, buildScene } from '../scenes.js';
import { measure } from '../metrics.js';
import { makeBox, makeCircle } from '../core/body.js';

const FIXED_DT = 1 / 60;

export function boot(World, opts = {}) {
  const canvas = document.getElementById('view');
  const renderer = new Renderer(canvas);
  const world = new World();

  const state = {
    running: true,
    sceneKey: sceneKeys[0],
    speed: 1,
    accumulator: 0,
    lastTime: performance.now(),
    stepMs: 0,
    frameMs: 0,
    fps: 0,
    apex0: 0,
    simTime: 0,
    stepCount: 0,
    drag: null,
    pan: null,
  };

  const strips = {
    pen: new Strip(document.getElementById('strip-pen'), '#ff9f68', 'max overlap (mm)'),
    energy: new Strip(document.getElementById('strip-energy'), '#79c7ff', 'kinetic energy (J)'),
    cost: new Strip(document.getElementById('strip-cost'), '#8ce99a', 'step cost (ms)'),
  };

  // -- scene handling --------------------------------------------------------

  function loadScene(key) {
    state.sceneKey = key;
    const s = buildScene(world, key);
    renderer.fitTo(s.view);
    state.apex0 = measure(world).apexHeight;
    state.simTime = 0;
    state.stepCount = 0;
    for (const k in strips) strips[k].reset();
    document.getElementById('scene-blurb').textContent = s.blurb;
    document.getElementById('btn-perturb').textContent = s.perturbLabel;
    return s;
  }

  // -- UI construction -------------------------------------------------------

  const sceneSelect = document.getElementById('scene');
  for (const k of sceneKeys) {
    const o = document.createElement('option');
    o.value = k; o.textContent = scenes[k].name;
    sceneSelect.appendChild(o);
  }
  sceneSelect.addEventListener('change', () => loadScene(sceneSelect.value));

  document.getElementById('btn-play').addEventListener('click', (e) => {
    state.running = !state.running;
    e.target.textContent = state.running ? 'Pause' : 'Play';
  });
  document.getElementById('btn-step').addEventListener('click', () => {
    state.running = false;
    document.getElementById('btn-play').textContent = 'Play';
    doStep();
  });
  document.getElementById('btn-reset').addEventListener('click', () => loadScene(state.sceneKey));
  document.getElementById('btn-perturb').addEventListener('click', () => {
    scenes[state.sceneKey].perturb(world);
  });

  const paramHost = document.getElementById('params');
  for (const p of World.params) {
    paramHost.appendChild(makeControl(world, p));
  }
  // Shared knobs, identical in both builds.
  paramHost.appendChild(makeControl(world, { key: 'allowSleep', label: 'Sleeping', type: 'bool' }));
  paramHost.appendChild(makeControl(world.gravity, { key: 'y', label: 'Gravity (m/s²)', min: -20, max: 0, step: 0.1 }));

  const debugHost = document.getElementById('debug');
  for (const [key, label] of [['contacts', 'Contact points'], ['normals', 'Contact normals'],
                              ['impulses', 'Normal impulse magnitude'], ['aabb', 'AABBs'], ['com', 'Centres of mass']]) {
    debugHost.appendChild(makeControl(renderer.show, { key, label, type: 'bool' }));
  }

  const speedSel = document.getElementById('speed');
  speedSel.addEventListener('change', () => { state.speed = parseFloat(speedSel.value); });

  // -- mouse -----------------------------------------------------------------

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const p = renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    if (e.button === 1 || e.shiftKey) {
      state.pan = { x: e.clientX, y: e.clientY, cx: renderer.camera.x, cy: renderer.camera.y };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.altKey) {
      const b = e.ctrlKey
        ? makeCircle(p.x, p.y, 0.14, { density: 3, friction: 0.5, color: '#c94f4f' })
        : makeBox(p.x, p.y, 0.14, 0.14, { friction: 0.5, color: '#7f9cc9' });
      world.addBody(b);
      world.wakeAll();
      return;
    }
    const body = pick(world, p);
    if (body) {
      state.drag = { body, target: p, offset: { x: p.x - body.position.x, y: p.y - body.position.y } };
      world.wakeAll();
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (state.pan) {
      const s = renderer.scale;
      renderer.camera.x = state.pan.cx - (e.clientX - state.pan.x) / s;
      renderer.camera.y = state.pan.cy + (e.clientY - state.pan.y) / s;
      return;
    }
    if (state.drag) state.drag.target = renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  });

  const endPointer = () => { state.drag = null; state.pan = null; };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.exp(e.deltaY * 0.0012);
    renderer.camera.height = Math.min(30, Math.max(0.4, renderer.camera.height * f));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); document.getElementById('btn-play').click(); }
    if (e.code === 'KeyR') loadScene(state.sceneKey);
    if (e.code === 'KeyP') document.getElementById('btn-perturb').click();
    if (e.code === 'Period') document.getElementById('btn-step').click();
  });

  /**
   * Dragging applies a critically-damped impulse towards the cursor rather than
   * teleporting the body. Teleporting would inject arbitrary constraint error,
   * which is exactly what these engines are being measured on.
   */
  function applyDrag() {
    const d = state.drag;
    if (!d || d.body.isStatic) return;
    const b = d.body;
    const px = b.position.x + d.offset.x, py = b.position.y + d.offset.y;
    const k = 24, c = 6;
    const fx = (d.target.x - px) * k - b.linearVelocity.x * c;
    const fy = (d.target.y - py) * k - b.linearVelocity.y * c;
    b.applyForce(fx / b.invMass, fy / b.invMass);
    b.wake();
  }

  // -- main loop -------------------------------------------------------------

  function doStep() {
    applyDrag();
    const t0 = performance.now();
    world.step(FIXED_DT);
    state.stepMs = state.stepMs * 0.9 + (performance.now() - t0) * 0.1;
    state.simTime += FIXED_DT;
    state.stepCount++;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;
    state.fps = state.fps * 0.9 + (1 / Math.max(dt, 1e-4)) * 0.1;

    if (state.running) {
      // Fixed timestep with an accumulator: the physics is identical whatever
      // the display refresh rate, which is what makes the two pages comparable.
      state.accumulator += dt * state.speed;
      let guard = 0;
      while (state.accumulator >= FIXED_DT && guard++ < 8) {
        state.accumulator -= FIXED_DT;
        doStep();
      }
      if (guard >= 8) state.accumulator = 0;   // give up rather than spiral
    }

    renderer.resize();
    renderer.draw(world);
    updateHud();
    requestAnimationFrame(frame);
  }

  const hudRows = {};
  function hud(label, value) {
    if (!hudRows[label]) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span>${label}</span><b></b>`;
      document.getElementById('hud').appendChild(row);
      hudRows[label] = row.querySelector('b');
    }
    hudRows[label].textContent = value;
  }

  let hudTick = 0;
  function updateHud() {
    const s = world.stats;
    if (state.stepCount % 2 === 0) {
      strips.pen.push(s.maxPenetration * 1000);
      strips.energy.push(s.energy);
      strips.cost.push(s.totalMs);
    }
    if (hudTick++ % 6 !== 0) return;

    const m = measure(world);
    hud('display fps', state.fps.toFixed(0));
    hud('sim time', state.simTime.toFixed(2) + ' s');
    hud('bodies', `${s.bodies} (${s.sleeping} asleep)`);
    hud('contacts / points', `${s.contacts} / ${s.points}`);
    hud('step cost', `${state.stepMs.toFixed(3)} ms`);
    hud('  broad / narrow', `${s.broadMs.toFixed(3)} / ${s.narrowMs.toFixed(3)} ms`);
    hud('  solve / position', `${s.solveMs.toFixed(3)} / ${s.positionMs.toFixed(3)} ms`);
    hud('max overlap', `${(s.maxPenetration * 1000).toFixed(3)} mm`);
    hud('mean overlap', `${(s.avgPenetration * 1000).toFixed(3)} mm`);
    hud('kinetic energy', `${s.energy.toFixed(4)} J`);
    hud('apex height', `${m.apexHeight.toFixed(3)} m  (${((m.apexHeight - state.apex0) * 1000).toFixed(0)} mm)`);
    hud('max displacement', `${(m.maxDisplacement * 1000).toFixed(1)} mm`);
    hud('bodies moving', `${m.movingBodies}`);

    strips.pen.draw(' mm');
    strips.energy.draw(' J');
    strips.cost.draw(' ms');
  }

  document.getElementById('engine-name').textContent = world.name;
  document.title = `${world.name} — 2D rigid body demo`;
  if (opts.accent) document.documentElement.style.setProperty('--accent', opts.accent);

  loadScene(state.sceneKey);
  sceneSelect.value = state.sceneKey;
  renderer.resize();
  requestAnimationFrame(frame);

  // Handy for poking at the sim from the console.
  window.demo = { world, renderer, state, loadScene, scenes };
}

/** Topmost body whose shape contains the point. */
function pick(world, p) {
  for (let i = world.bodies.length - 1; i >= 0; i--) {
    const b = world.bodies[i];
    if (b.isStatic) continue;
    if (b.shape.type === 'circle') {
      if (Math.hypot(p.x - b.position.x, p.y - b.position.y) <= b.shape.radius) return b;
    } else {
      let inside = true;
      const v = b.worldVerts, n = b.worldNormals;
      for (let k = 0; k < v.length; k++) {
        if (n[k].x * (p.x - v[k].x) + n[k].y * (p.y - v[k].y) > 0) { inside = false; break; }
      }
      if (inside) return b;
    }
  }
  return null;
}

function makeControl(target, p, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'ctl';
  if (p.type === 'bool') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!target[p.key];
    input.addEventListener('change', () => { target[p.key] = input.checked; if (onChange) onChange(); });
    wrap.appendChild(input);
    const span = document.createElement('span');
    span.textContent = p.label;
    wrap.appendChild(span);
    return wrap;
  }
  const head = document.createElement('span');
  const val = document.createElement('b');
  const fmt = (v) => (p.step >= 1 ? v.toFixed(0) : String(+v.toFixed(6)));
  head.textContent = p.label;
  val.textContent = fmt(target[p.key]);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = p.min; input.max = p.max; input.step = p.step;
  input.value = target[p.key];
  input.addEventListener('input', () => {
    target[p.key] = parseFloat(input.value);
    val.textContent = fmt(target[p.key]);
    if (onChange) onChange();
  });
  const row = document.createElement('div');
  row.className = 'ctl-head';
  row.appendChild(head); row.appendChild(val);
  wrap.appendChild(row);
  wrap.appendChild(input);
  return wrap;
}
