# Notes — procedural worlds

Goal: four self-contained WebGL2 HTML files (no libraries, assets or build), each a
different generative foundation, small (<30KB), seeded, never visibly looping.

## Plan / choice of foundations

| file | foundation | mood / scale | camera |
|---|---|---|---|
| strata.html | raymarched heightfield: warped, slope-damped fbm → soft terracing → detail | vast, slow, warm dusk | endless forward flight, steers to low ground |
| ink-mould.html | GPU agent simulation (Physarum), 3 interacting species | intimate, teeming, light "paper" | slow pan across a torus |
| reef.html | space colonisation growth + pipe-model thickness | close, calm, underwater | low glide over a seabed where colonies grow |
| strange-dust.html | searched chaotic 3D quadratic maps (Sprott), 0.5M particles | cosmic, contemplative | slow orbit, DOF |

Deliberately different palettes: ochre/rust dusk; cream paper + indigo/vermilion/gold;
teal/blue/violet water with coral pastels; black space with luminous veils.

## Testing harness

`shot.js` (Playwright + SwiftShader). Headless Chromium has no GPU here, so frames are slow
(a full-res raymarch frame of strata takes ~1-2 s). The page's own rAF loop starved
screenshots, so the harness replaces `requestAnimationFrame` with a manual stepper
(`window.__step(n, dt)`), calls `gl.finish()` every 20 steps, then screenshots. Test-only
query parameters:

- `strata.html?s=0.6` fixes the render scale (otherwise adaptive).
- `reef.html?w=70` pre-simulates 70 s of growth before the first frame.

Timing inside SwiftShader is fake, so the adaptive quality controls (render scale, sim
steps per frame, particle count) are not representative there.

## Strata

- First pass: noisy "gravel" look — the post-terrace detail octaves were far too strong and
  the feature scale too small; camera hugged plateaus. Fixed by scaling the land up
  (freq .045→.026, height ×6→×10), terrace mix .93, detail amplitude ×.28.
- Camera originally computed in the shader (soft-max of terrain at path samples). Moved
  to JS with a CPU port of the low-octave terrain (same PCG-style integer hash, same
  quintic value noise with derivatives) so the camera can: steer laterally toward lower
  ground (difference of terrain left/right at 3 lookahead distances), climb fast/descend
  slowly, and keep a smoothed heading. Result: flights through flooded canyons with
  mesa walls instead of skimming tabletops.
- Haze was milky; reduced distance haze and height-fog density, added a mild S-curve.
- Floodwater: plane intersection, ripple normal from noise derivatives, fresnel,
  80-step reflection march without shadows, depth-tinted bed colour.
- Adaptive resolution: render into a fixed-size FBO using a sub-viewport, blit-upscale
  with LINEAR; scale ±4-8% every 10 frames from an EMA of frame time.

## Ink Mould

- Agents in RGBA32F (x, y, heading, species), deposit as GL_POINTS with additive blending
  into RGBA16F trails (needs EXT_color_buffer_float; half-float blending comes with it).
- Each species senses `dot(trail.rgb, W[species])` — self weight 1, cross weights random in
  [-1.3, .5] and drifting — gives territories, chasing and mixing.
- All sensor/turn/step parameters drift on slow incommensurate sines → regime changes.
- First test: 0.25 agents/px gave thick, blobby tubes; raised to ~0.49 agents/px.
- Display is subtractive (paper × ink transmittance) with rim darkening from the trail
  gradient; the metallic channel is shaded as embossed gold leaf lit by a wandering lamp.

## Strange Dust

- Search: random coefficients on Sprott's 0.1 grid in [-1.2, 1.2]; reject escape,
  zero-separation (collapse), Lyapunov < .04, flat (σmin/σmax < .18), and correlation
  dimension outside [1.3, 2.5] (pair counts at .04σ and .4σ).
- First render invisible: brightness constant was off by 1000×. Then fixed by making
  per-point energy `k·W·H/(N·PS²)`.
- Colour by step length was saturated at one end; normalised by the mean step length
  measured during the search.
- Dense attractors blew out to white; added auto-exposure: a 1×1 pass computes the
  density-weighted mean brightness Σl²/Σl over a coarse mip (≈40px cells) and eases it;
  tone map on luminance to keep hue. Blocky bloom from a single coarse mip was fixed with
  4 offset taps per level.
- Transitions: particles carry their group in the sign of w; a hash threshold MX sweeps
  0→1 (or back), each switching particle respawns from the new attractor's orbit texture
  and fades in by age.

## Reef

- Space colonisation per colony (attractor envelope + one root): staghorn ellipsoid,
  sea fan (thin disc), table (stem + plate), pillar clumps, sunburst dome (shell).
  A small blob of attractors near the root kick-starts growth.
- Per-colony spatial hash keyed by packed 10-bit cell coords; duplicate guard rejects new
  nodes within D/2 of an existing one; colony stops after 6 idle iterations.
- Pipe model: each new node increments descendant counts up the chain;
  r = (.05 + .026·n^.47)·shapeScale, capped.
- Rendering: one instance per node, capsule generated from gl_VertexID (6 sides,
  cylinder + 2-ring cap = 108 verts; shadow pass uses 72), sprouting animation in VS.
- First test: sand blown out to white by caustics; coral sparse and thin. Reduced sun and
  caustic gain, thicker radii, more colonies with patchy density (reef patches and sand
  channels). Ambient partly untinted so coral colours survive the water colour.
- Growth rate: each colony iterates every 0.75 s once within 42 units of the camera, so
  growth is visible as it comes out of the fog.
- Compaction every 25 units of travel drops nodes 16 units behind the camera and remaps
  parents.

## Late fixes

- Strange Dust orbit speed was ~1.2 rad/s due to a units slip (ms vs s); now 0.045 rad/s.
- Ink Mould "ring" start mode had tangential headings, which just made stable rotating
  rings for a long time; now rings with random headings. Parameter ranges narrowed slightly
  toward network-forming regimes. Sim size capped at 1280² (≤ ~800k agents).
- Reef: sand albedo and ambient reduced again, brightest lagoon palette darkened, coral
  saturation boosted 1.35× so colour survives the water tint; shadow pass draws only the
  cylinder + first cap ring (72 of 108 verts).
- Harness gotcha: `pkill -f shot.js` killed the shell running it (its own command line
  matched).
