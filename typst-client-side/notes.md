# Notes: client-side Typst rendering

## Starting point
- Simon Willison's post "Tool: LaTeX renderer" (2026-10-15, https://simonwillison.net/2026/Oct/15/latex/).
  Couldn't fetch it directly (simonwillison.net blocked from this sandbox), but search snippets say:
  MathJax 4.1.3 for single equations, faster-latex 0.3.1 (WebAssembly) for full documents,
  source kept in the URL fragment compressed with Pako 2.1.0 + a LaTeX-tuned deflate dictionary,
  output isolated in a sandboxed iframe, DOMPurify 3.4.16.
- Goal: same idea for Typst.

## Finding a Typst WASM build
- Typst itself is Rust, so it compiles to wasm. The maintained browser packaging is
  typst.ts (Myriad-Dreamin/typst.ts) on npm:
  - `@myriaddreamin/typst.ts@0.7.0` (JS API, incl. `dist/esm/contrib/all-in-one-lite.bundle.js`, 211 KB, self-contained glue)
  - `@myriaddreamin/typst-ts-web-compiler@0.7.0` (compiler wasm, 28 MB uncompressed)
  - `@myriaddreamin/typst-ts-renderer@0.7.0` (renderer wasm, 0.97 MB) - turns compiled "vector" artifact into SVG
  - `@myriaddreamin/typst-all-in-one.ts` - 39 MB JS with wasm inlined; too big, not used.
- The wasm contains `typst-assets-0.14.2` => Typst 0.14.
- Fonts are NOT usable from the wasm out of the box: default loader fetches
  `https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.13.1/files/fonts/...`. typst-assets v0.14.2
  has the same 17 "text" fonts (Libertinus Serif, New Computer Modern + Math, DejaVu Sans Mono), ~8.4 MB raw.
- Packages (`#import "@preview/..."`) are fetched from packages.typst.org by `FetchPackageRegistry`.

## Sandbox constraints
- cdn.jsdelivr.net, unpkg, cdnjs, packages.typst.org are all blocked from this container (proxy 403).
  registry.npmjs.org and raw.githubusercontent.com work.
- So for testing: npm install the exact packages + download fonts from raw.githubusercontent, then run
  headless Chromium (Playwright) with `page.route()` mapping the CDN URLs onto the local files.
  The HTML itself references the real CDN URLs, so it works unchanged on GitHub Pages.

## Demo document (demo.typ)
- Wrote a ~19 KB feature tour: page setup + running headers, outline, markup, lists, refs, footnotes,
  quotes, maths (alignment, cases, matrices, decorations, numbering), syntax-highlighted raw blocks,
  scripting (functions, closures, loops, destructuring, regex, calc), show rules (incl. regex and text
  replacement), grid/stack/columns/place/measure/layout, tables (header, colspan/rowspan, fill and
  stroke functions), CSV + JSON data -> table and bar chart, shapes/curves/gradients/tilings/colour
  spaces, SVG images, counters/state/query, bibliography (BibTeX), fonts/OpenType features,
  hyphenation in en/de/fr.
- Everything is inline (`csv(bytes(...))`, `bibliography(bytes(...))`, `image(bytes(...))`) so a shared
  link carries the whole document and no virtual files are needed.
- Checked it first with the native compiler (`pip install typst` -> typst-py 0.14.9):
  - `calc.pow(2, 64)` overflows ("the result is too large"), now 2^62.
  - `angle.l`/`angle.r` deprecated in 0.14 -> `chevron.l`/`chevron.r`.
  - A grid row of `auto` height with `height: 100%` cells grew to fill the page; fixed rows.
  - Boxes of width `1fr` in a `stack` collapsed; use a `grid` instead.
  - Running header queried "last heading before here()", which on a page that starts a section
    shows the previous section. Fixed by preferring a heading that is on the current page.
- Final result: 11 pages, no warnings, natively and in the browser.

## The page (typst.html)
- Loads `all-in-one-lite.bundle.js` as an ES module from jsDelivr, fetches the two wasm files and 17
  fonts itself (to show a progress bar), then hands bytes to typst.ts:
  `$typst.setCompilerInitOptions({ getModule: () => bytes, beforeBuild: [loadFonts(fontBytes, { assets: false })] })`.
- Uses the `$typst` snippet only to construct things (it auto-registers `FetchPackageRegistry` for
  `@preview` imports in browsers), then talks to the low-level compiler directly because the snippet
  helpers hard-code `diagnostics: 'none'`. `compiler.compile({ mainFilePath, diagnostics: 'full' })`
  returns `{ result, diagnostics: [{ severity, path, range: "line:col-line:col" (0-based), message, hints }] }`.
- SVG via `renderer.runWithSession(s => { manipulateData(reset); renderSvg({ data_selection: { js: false, ... } }) })`.
  Without `js: false` the SVG carries an interactivity `<script>` (blocked by the sandbox, noisy in console).
- typst.ts stacks pages edge-to-edge on a transparent background in one big SVG. The preview
  re-positions each `g.typst-page` (it has `data-page-width/height`) with a gap and inserts a white
  `rect.page-bg` with a drop-shadow behind it.
- Preview iframe: `sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"` - no
  scripts can run in it; same-origin lets the parent replace the SVG in place, so scroll position
  survives re-renders. (Simon's tool also isolates output in a sandboxed iframe.)
- PDF export: same compiler, `format: 1`.
- URL fragment: `#z=` + base64url(raw deflate with a preset dictionary of common Typst snippets),
  pako 2.1.0 from cdnjs; `#src=` also accepted for plain URL-encoded text.
  The dictionary helps short docs most: hello-world 142 -> 116 bytes; the 19 KB tour 8216 -> 7980 bytes
  (10.6 K chars of fragment).

## Measurements (headless Chromium, assets served locally)
- Downloads: compiler wasm 28.3 MB (7.2 MB brotli), renderer 1.0 MB (0.3 MB), fonts 8.8 MB
  (5.8 MB gzip), JS 0.2 MB. ~13 MB over the network on first visit, then HTTP-cached.
- Feature tour: first compile ~1.8-2.0 s, SVG render ~0.4-0.6 s. Re-compile after an edit 170-470 ms
  + ~200 ms render (incremental caches kick in). This runs on the main thread, so typing can hitch
  briefly on big documents; a Web Worker would fix that (not done).
- SVG of the 11-page tour is ~2.5 MB; PDF is 344 KB.

## Packages
- `#import "@preview/showybox:2.0.4"` works: typst.ts does a synchronous XHR for
  `https://packages.typst.org/preview/<name>-<version>.tar.gz` and untars it in wasm.
  Tested with a tarball rebuilt from github.com/typst/packages (packages.typst.org is blocked here),
  so real-world CORS on packages.typst.org is untested from this sandbox.

## Testing
- test/browser-test.mjs: Playwright, maps CDN URLs to local files with page.route(), checks
  compile/page count/diagnostics/fragment round trip/link loading/PDF/package/mobile overflow,
  saves screenshots. All checks pass.
