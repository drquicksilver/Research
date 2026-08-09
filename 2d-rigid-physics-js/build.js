#!/usr/bin/env node
// Bundles the ES modules into two standalone HTML files with no imports, no
// build tooling and no network dependencies at all — open the file, it runs.
//
// The sources are written as ES modules so Node can import them directly for
// the headless bench and tests; this strips the import/export syntax and
// concatenates in dependency order inside one IIFE.
//
//   node build.js

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const SHARED = [
  'src/core/math.js',
  'src/core/body.js',
  'src/core/collide.js',
  'src/core/broadphase.js',
  'src/core/sleep.js',
  'src/scenes.js',
  'src/metrics.js',
  'src/app/renderer.js',
  'src/app/ui.js',
];

/** Strip module syntax. Every top-level name is unique across the bundle. */
function strip(src, file) {
  const out = src
    .replace(/^\s*import\s+[^;]*?;\s*$/gm, '')
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+(default\s+)?/gm, '')
    .replace(/^\s*export\s*\{[^}]*\};\s*$/gm, '');
  if (/\bimport\b|\bexport\b/.test(out.replace(/import\.meta/g, ''))) {
    const bad = out.split('\n').filter((l) => /^\s*(import|export)\b/.test(l));
    if (bad.length) throw new Error(`${file}: module syntax survived stripping:\n${bad.join('\n')}`);
  }
  return `// ===== ${file} =====\n${out.trim()}\n`;
}

const css = `
:root {
  --accent: #79c7ff;
  --bg: #12151c;
  --panel: #191d26;
  --line: #262c39;
  --text: #dce4f2;
  --muted: #8b95a8;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--text);
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  display: flex; overflow: hidden;
}
#stage { flex: 1 1 auto; position: relative; min-width: 0; }
#view { width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
#view:active { cursor: grabbing; }
#overlay {
  position: absolute; left: 14px; top: 12px; pointer-events: none;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
}
#overlay h1 { margin: 0; font-size: 15px; letter-spacing: 0.02em; color: var(--accent); }
#overlay p { margin: 3px 0 0; max-width: 46ch; color: var(--muted); font-size: 12px; }
#panel {
  flex: 0 0 302px; background: var(--panel); border-left: 1px solid var(--line);
  padding: 14px 14px 22px; overflow-y: auto;
}
#panel h2 {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.09em;
  color: var(--muted); margin: 18px 0 8px; font-weight: 600;
}
#panel h2:first-child { margin-top: 0; }
select, button {
  font: inherit; color: var(--text); background: #222836;
  border: 1px solid var(--line); border-radius: 5px; padding: 5px 8px;
}
button { cursor: pointer; }
button:hover { background: #2b3242; }
select { width: 100%; }
.buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
.buttons .wide { grid-column: 1 / -1; }
.ctl { display: block; margin-bottom: 9px; font-size: 12px; }
.ctl input[type=range] { width: 100%; accent-color: var(--accent); margin: 2px 0 0; }
.ctl input[type=checkbox] { accent-color: var(--accent); margin-right: 7px; vertical-align: -1px; }
.ctl-head { display: flex; justify-content: space-between; color: var(--muted); }
.ctl-head b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
#hud .row {
  display: flex; justify-content: space-between; gap: 8px;
  font-size: 11.5px; padding: 1.5px 0; color: var(--muted);
}
#hud .row b {
  color: var(--text); font-weight: 500;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums;
}
canvas.strip { width: 100%; height: 40px; display: block; margin-bottom: 5px; border-radius: 3px; }
.hint { color: var(--muted); font-size: 11px; margin: 10px 0 0; }
.hint kbd {
  background: #222836; border: 1px solid var(--line); border-radius: 3px;
  padding: 0 4px; font-family: inherit; font-size: 10.5px;
}
`;

function page(engineFile, accent, blurb) {
  const parts = [];
  for (const f of SHARED.slice(0, 5)) parts.push(strip(readFileSync(join(root, f), 'utf8'), f));
  parts.push(strip(readFileSync(join(root, engineFile), 'utf8'), engineFile));
  for (const f of SHARED.slice(5)) parts.push(strip(readFileSync(join(root, f), 'utf8'), f));
  parts.push(`boot(World, { accent: ${JSON.stringify(accent)} });`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>2D rigid body demo</title>
<style>${css}</style>
</head>
<body>
<div id="stage">
  <canvas id="view"></canvas>
  <div id="overlay">
    <h1><span id="engine-name"></span></h1>
    <p id="scene-blurb"></p>
  </div>
</div>
<aside id="panel">
  <h2>Scene</h2>
  <select id="scene"></select>
  <div class="buttons">
    <button id="btn-play">Pause</button>
    <button id="btn-step">Step</button>
    <button id="btn-reset">Reset</button>
    <select id="speed" title="Simulation rate">
      <option value="1">1x speed</option>
      <option value="0.25">0.25x</option>
      <option value="0.1">0.1x</option>
      <option value="2">2x</option>
    </select>
    <button id="btn-perturb" class="wide">Perturb</button>
  </div>

  <h2>Solver — ${blurb}</h2>
  <div id="params"></div>

  <h2>Debug draw</h2>
  <div id="debug"></div>

  <h2>Measurements</h2>
  <div id="hud"></div>
  <canvas class="strip" id="strip-pen"></canvas>
  <canvas class="strip" id="strip-energy"></canvas>
  <canvas class="strip" id="strip-cost"></canvas>

  <p class="hint">
    Drag bodies with the mouse. <kbd>Alt</kbd>+click spawns a box,
    <kbd>Alt</kbd>+<kbd>Ctrl</kbd>+click a ball. <kbd>Shift</kbd>+drag pans,
    scroll zooms. <kbd>Space</kbd> pause, <kbd>.</kbd> single step,
    <kbd>R</kbd> reset, <kbd>P</kbd> perturb.
  </p>
</aside>
<script>
(function () {
"use strict";
${parts.join('\n')}
})();
</script>
</body>
</html>
`;
}

const builds = [
  ['src/engines/si.js', 'sequential-impulses.html', '#ffd166', 'sequential impulses'],
  ['src/engines/xpbd.js', 'xpbd.html', '#8ce99a', 'substepped XPBD'],
];

for (const [engine, out, accent, blurb] of builds) {
  const html = page(engine, accent, blurb);
  writeFileSync(join(dist, out), html);
  console.log(`${out.padEnd(28)} ${(html.length / 1024).toFixed(1)} KiB`);
}
