// Headless check for the pieces: drives requestAnimationFrame manually so slow software
// GL (SwiftShader) can still produce frames, collects console errors and saves screenshots.
// usage: [Q=?query] [HASH=seed] node shot.js file.html out-prefix w h dtms steps1,steps2,...
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const [file, out = 'shot', w = '640', h = '360', dt = '33', steps = '30'] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  p.on('console', m => console.log('console:', m.type(), m.text()));
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.addInitScript(() => {
    let cb = null, t = 0;
    window.requestAnimationFrame = f => { cb = f; return 1 };
    window.__step = (n, dt) => { for (let i = 0; i < n; i++) { t += dt; const f = cb; cb = null; f && f(t) } };
  });
  await p.goto('file://' + require('path').resolve(file) + (process.env.Q || '') + (process.env.HASH ? '#' + process.env.HASH : ''));
  let i = 0;
  for (const n of steps.split(',')) {
    const t0 = Date.now();
    for (let k = 0; k < +n; k += 20) await p.evaluate(([n, dt]) => { window.__step(n, dt); document.querySelector('canvas').getContext('webgl2').finish() }, [Math.min(20, +n - k), +dt]);
    await p.screenshot({ path: `${out}-${++i}.png`, timeout: 300000 });
    console.log(`shot ${i}: ${n} steps in ${Date.now() - t0}ms`, await p.evaluate(() => window.__fps || ''));
  }
  await b.close();
})();
