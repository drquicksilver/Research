// Headless-Chromium test for typst.html.
//
// The sandbox this was built in cannot reach the CDNs, so every CDN URL the page
// requests is answered from local copies of the exact same files:
//   NODE_MODULES  npm install @myriaddreamin/typst.ts@0.7.0 \
//                   @myriaddreamin/typst-ts-web-compiler@0.7.0 \
//                   @myriaddreamin/typst-ts-renderer@0.7.0 pako@2.1.0
//   FONTS         the 17 font files from typst/typst-assets@v0.14.2/files/fonts
//   PACKAGES      optional: <name>-<version>.tar.gz files standing in for packages.typst.org
//   OUT           where screenshots and the exported PDF go
//
// Run: NODE_MODULES=... FONTS=... OUT=... node test/browser-test.mjs
// PLAYWRIGHT can point at a global install, e.g. /opt/node-tools/node_modules/playwright/index.mjs
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.join(here, '..', 'typst.html');
const { NODE_MODULES, FONTS, PACKAGES, OUT = '.' } = process.env;
const ORIGIN = 'https://typst-demo.test';

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
function serveFile(route, file) {
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'missing ' + file });
  return route.fulfill({
    status: 200,
    body: fs.readFileSync(file),
    headers: {
      'content-type': types[path.extname(file)] || 'application/octet-stream',
      'access-control-allow-origin': '*',
    },
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));

const requested = new Set();
function routeCdns(p) {
  return p.route('**/*', route => {
    const url = new URL(route.request().url());
    requested.add(url.origin);
    let m;
    if (url.origin === ORIGIN) return serveFile(route, html);
    if (url.host === 'cdn.jsdelivr.net' && (m = /^\/npm\/(@myriaddreamin\/[^@]+)@0\.7\.0\/(.*)$/.exec(url.pathname)))
      return serveFile(route, path.join(NODE_MODULES, m[1], m[2]));
    if (url.host === 'cdn.jsdelivr.net' && (m = /^\/gh\/typst\/typst-assets@v0\.14\.2\/files\/fonts\/(.*)$/.exec(url.pathname)))
      return serveFile(route, path.join(FONTS, m[1]));
    if (url.host === 'cdnjs.cloudflare.com' && url.pathname.endsWith('/pako/2.1.0/pako.min.js'))
      return serveFile(route, path.join(NODE_MODULES, 'pako/dist/pako.min.js'));
    if (url.host === 'packages.typst.org' && PACKAGES)
      return serveFile(route, path.join(PACKAGES, path.basename(url.pathname)));
    return route.abort();
  });
}
await routeCdns(page);

const status = () => page.locator('#status').textContent();
const waitForStatus = (re, timeout = 120000) =>
  page.waitForFunction(src => new RegExp(src).test(document.getElementById('status').textContent), re.source, { timeout });

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };

// 1. Load with no fragment: the feature tour compiles.
const t0 = Date.now();
await page.goto(ORIGIN + '/typst.html');
await waitForStatus(/Compiled in|error/);
console.log(`  status: ${await status()} (${Date.now() - t0} ms incl. load)`);
check(/Compiled in .* 11 pages/.test(await status()), 'feature tour compiles to 11 pages');
check((await page.locator('#diagnostics .diag').count()) === 0, 'no diagnostics for the tour');
const svgInfo = await page.evaluate(() => {
  const doc = document.getElementById('preview').contentDocument;
  const svg = doc.querySelector('#pages > svg');
  return { pages: doc.querySelectorAll('.typst-page').length, size: svg?.outerHTML.length, scripts: doc.querySelectorAll('script').length };
});
console.log('  preview:', JSON.stringify(svgInfo));
check(svgInfo.pages === 11, 'preview iframe holds 11 SVG pages');
await page.screenshot({ path: path.join(OUT, 'screenshot-tour.png') });
fs.writeFileSync(path.join(OUT, 'tour.svg'), await page.evaluate(() => window.typstApp.svg));

// Scroll the preview to a few pages and screenshot each.
for (const [n, name] of [[3, 'maths'], [7, 'tables'], [8, 'shapes']]) {
  await page.evaluate(n => {
    const doc = document.getElementById('preview').contentDocument;
    doc.querySelectorAll('.typst-page')[n].scrollIntoView();
  }, n);
  await page.waitForTimeout(200);
  await page.locator('#preview').screenshot({ path: path.join(OUT, `screenshot-${name}.png`) });
}

// 2. Recompile speed for an edit (warm compiler).
const editTimes = [];
for (let i = 0; i < 3; i++) {
  await page.evaluate(i => {
    const ta = document.getElementById('source');
    ta.value = ta.value.replace(/A Tour of Typst\]/, `A Tour of Typst ${i}]`);
    ta.dispatchEvent(new Event('input'));
  }, i);
  await page.waitForTimeout(300);
  await waitForStatus(/Compiled in/);
  editTimes.push(await status());
}
console.log('  after edits:', editTimes.join(' | '));
const hash = await page.evaluate(() => location.hash);
check(hash.startsWith('#z='), `edits update the URL fragment (${hash.length} chars)`);

// 3. A syntax error produces a clickable diagnostic and keeps the last render.
await page.evaluate(() => window.typstApp.setSource('= Hello\n\n#let x = (1, 2\n\nSome text #undefined-thing\n'));
await page.waitForSelector('#diagnostics .diag');
const diags = await page.locator('#diagnostics .diag').allTextContents();
console.log('  diagnostics:', JSON.stringify(diags));
check(diags.length > 0 && /error/i.test(diags[0]), 'errors are reported');
await page.locator('#diagnostics').screenshot({ path: path.join(OUT, 'screenshot-error.png') });

// 4. Fragment round trip, including non-ASCII text.
const sample = '#set page(width: 8cm, height: auto)\n= Ünïcødé ✓\n$ x^2 $ — “quotes”\n';
const enc = await page.evaluate(s => window.typstApp.encodeSource(s), sample);
const dec = await page.evaluate(h => window.typstApp.decodeHash('#' + h), enc);
check(dec === sample, `fragment round trip (${enc.length} chars for ${sample.length} chars)`);
const demoSrc = await page.evaluate(() => document.getElementById('demo-source').textContent);
const demoEnc = await page.evaluate(s => window.typstApp.encodeSource(s), demoSrc);
console.log(`  feature tour: ${demoSrc.length} chars -> ${demoEnc.length} char fragment`);

// 5. Opening a link with a fragment renders that document.
await page.close();
const page3 = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page3.on('pageerror', e => consoleErrors.push(String(e)));
await routeCdns(page3);
await page3.goto(ORIGIN + '/typst.html#' + enc);
await page3.waitForFunction(() => /Compiled in|error/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
check((await page3.locator('#source').inputValue()) === sample, 'link fragment loads into the editor');
check(/1 page/.test(await page3.locator('#status').textContent()), 'link document compiles');
await page3.screenshot({ path: path.join(OUT, 'screenshot-link.png') });

// 6. PDF export.
await page3.evaluate(() => window.typstApp.setSource(document.getElementById('demo-source').textContent));
await page3.waitForFunction(() => /11 pages/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
const [download] = await Promise.all([page3.waitForEvent('download'), page3.click('#download-pdf')]);
const pdfPath = path.join(OUT, 'tour.pdf');
await download.saveAs(pdfPath);
const pdf = fs.readFileSync(pdfPath);
check(pdf.subarray(0, 5).toString() === '%PDF-', `PDF export (${download.suggestedFilename()}, ${(pdf.length / 1024).toFixed(0)} KB)`);

// 7. Package import (only when local package tarballs are provided).
if (PACKAGES) {
  await page3.evaluate(() => {
    const sel = document.getElementById('examples');
    window.confirm = () => true;
    sel.value = 'package';
    sel.dispatchEvent(new Event('change'));
  });
  await page3.waitForTimeout(500);
  await page3.waitForFunction(() => /Compiled in|error/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  const st = await page3.locator('#status').textContent();
  console.log('  package example:', st, await page3.locator('#diagnostics').textContent());
  check(/Compiled in/.test(st), '@preview package import works');
  await page3.screenshot({ path: path.join(OUT, 'screenshot-package.png') });
}

// 8. Mobile layout has no horizontal scroll.
await page3.setViewportSize({ width: 390, height: 844 });
await page3.waitForTimeout(300);
const overflow = await page3.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, `no horizontal page scroll at phone width (overflow ${overflow}px)`);
await page3.screenshot({ path: path.join(OUT, 'screenshot-mobile.png') });

console.log('  origins requested:', [...requested].join(', '));
if (consoleErrors.length) console.log('  console errors:', consoleErrors.slice(0, 10));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
