# Notes: implementing a 2D rigid body physics engine in JavaScript

Running log. Newest entries appended at the bottom.

## 2026-08-08 — Framing the problem

Task: investigate how to build a 2D rigid physics engine in JS, pick the two best
approaches, ship each as a self-contained client-side HTML page, run the *same*
demos through both, and evaluate.

The hard requirement — "house of cards / rigid structure collapse when unstable" —
is the thing that actually selects the approach. Anyone can bounce a ball. The
discriminating workload is:

1. **Persistent resting contact** with many simultaneous contacts (a card tower is
   a big coupled contact graph, not a sequence of isolated impacts).
2. **Dry friction that actually holds.** A house of cards stands only because
   static friction at the apex and floor contacts resists sliding. An engine with
   sloppy friction has cards that creep and splay until the structure sits down.
3. **Thin geometry.** Cards have extreme aspect ratios. Real playing card is
   89 mm x 0.3 mm ≈ 300:1, which nothing in games handles. Need to pick a
   defensible "thin plank" ratio and be honest about it.
4. **Stability under marginal equilibrium.** A structure that is *barely* stable
   must stay up, but must also fall over convincingly when perturbed. Engines that
   cheat stability (heavy damping, huge slop, position snapping) get the first
   half and fail the second.

So the evaluation axes are: stacking stability, friction fidelity, penetration
(constraint error), energy behaviour, cost per frame, and parameter sensitivity.

## Survey of candidate approaches

Options considered before picking two:

### A. Penalty / soft contact (spring-damper at contacts)
Push bodies apart with `F = k*d - c*v`. Trivial to write, differentiable, no
solver. Fatal for this task: stiff contacts need huge `k`, huge `k` needs tiny
`dt` for explicit integration, and a card tower is a stiff serial chain, so the
required `k` grows with stack height. Also visible sponginess. **Rejected.**

### B. Global LCP / MLCP with a direct solver (Dantzig, Lemke)
Formulate the whole contact problem as a mixed LCP and solve it exactly (this is
ODE's "dWorldStep" path). Accurate, handles high mass ratios, but O(n^3)-ish,
painful to implement correctly in JS, friction requires a polygonal cone
approximation or an outer iteration, and it is brittle to redundant/degenerate
contact sets — which is exactly what a symmetric card structure produces.
**Rejected**: implementation risk far exceeds the value here.

### C. Sequential impulses (projected Gauss–Seidel on the velocity-level LCP)
The Box2D / Erin Catto lineage. Iterate the contacts, applying corrective
impulses one at a time with accumulated-impulse clamping, warm-start from the
previous frame's impulses, and fix drift with a separate positional pass.
This is the industry default for 2D games precisely because it stacks well.
**Selected as Approach 1.**

### D. Position-based dynamics, specifically substepped XPBD
Müller et al. 2020, "Detailed Rigid Body Simulation with Extended Position Based
Dynamics". Integrate positions explicitly with small substeps, project the
constraints at the *position* level, then back out velocities by finite
difference. Key insight of the paper: N substeps with 1 iteration beats 1 step
with N iterations. Compliance (inverse stiffness) makes it resolution-independent.
Static friction is handled positionally, which is very attractive for the house
of cards. **Selected as Approach 2.**

### E. Verlet particles + distance constraints ("rigid bodies as particle clusters")
The Thomas Jakobsen / Advanced Character Physics trick. Charming and short, but
bodies are only *approximately* rigid, inertia is implicit in particle layout,
friction is a hack, and thin boxes made of 4 particles wobble. Fine for ragdolls
and rope, wrong for card towers. **Rejected.**

### F. Featherstone / reduced-coordinate articulated bodies
Great for robots and ragdolls with joints, irrelevant for a pile of unconnected
rigid cards where all coupling is through unilateral contact. **Rejected.**

### G. Speculative / continuous collision as a *primary* strategy
Not really a solver family — it's an orthogonal feature. Rolled into both engines
as speculative contacts rather than treated as an approach.

Decision: **C (sequential impulses)** and **D (substepped XPBD)**. They are the
two genuinely dominant modern answers, they fail in *different* ways, and both
are implementable to production quality in a few hundred lines each.

## Architecture decision: share everything except the solver

To make the comparison honest, both engines must be fed byte-identical geometry
and contact data. So:

- `src/core/` — vector math, body/shape definitions, mass properties, broadphase,
  and the SAT narrowphase producing 2-point manifolds. **Shared.**
- `src/scenes.js` — the demo scenes, seeded so both engines get identical inputs.
  **Shared.**
- `src/app/` — canvas renderer, UI harness, metrics/HUD. **Shared.**
- `src/engines/si.js` and `src/engines/xpbd.js` — the *only* files that differ.

Both engines expose the same `World` API (`addBody`, `step(dt)`, `bodies`,
`stats`) so the harness is engine-agnostic. Any difference in the demos is
therefore attributable to the solver, which is the entire point.

Self-containment: sources are written as ES modules (so Node can import them for
headless benchmarking), and `build.js` strips import/export lines and inlines
everything into two standalone HTML files with zero network dependencies.

## Debugging log — getting both solvers correct

Built a `test.js` of physics facts that must hold for either solver (rest height,
stack sinking, free-fall bias, the Coulomb threshold on a ramp, restitution
apex, momentum conservation, tunnelling, and the house of cards standing and
then falling). Every bug below was found by that suite rather than by looking at
the demo, which is the point of having it.

**Bug 1 — reference-face tangent sign (shared narrowphase).** Face normals are
built as `n = (ey, -ex)/|e|`, so the edge direction is `(-ny, nx)`, not
`(ny, -nx)`. I had the latter, which swapped the two clip planes so
`lower > upper` and *every* polygon manifold came back empty. Symptom: all
bodies in free fall through the ground. Worth noting that this is invisible in
a circle-only test — polygon clipping is where 2D engines actually break.

**Bug 2 — speculative contact bias sign (sequential impulses).** The
non-penetration constraint at a positive gap `s` is `vn >= -s/dt`, which enters
the solve as `impulse = -mass * (vn + s/dt)`. I had `(vn - s/dt)`, which
*demands* that any pair within the speculative margin separate at `s/dt`. Every
near-contact became a repulsor: the box tower blew itself apart at 120 mm of
overlap, boxes ejecting each other frame after frame. Once fixed, the same
tower settles to sub-millimetre penetration.

**Bug 3 — uninitialised previous pose on static bodies (XPBD).** XPBD's static
friction works by measuring how far the two contact anchors slid past each other
*during the substep*, comparing the current anchor position against the anchor
evaluated at the pre-substep pose. Static bodies are never touched by the
integrator, so their `prevPosition`/`prevAngle` stayed at the constructor's
zeros — meaning every contact against the ground or a ramp reported a slip of
however far that static body happened to be from the origin. Blocks slid down
25° ramps at μ = 0.8. Initialising `prevPose` to the current pose in the Body
constructor fixed all four ramp cases at once.

Worth generalising: *every* piece of state that the integrator maintains lazily
needs a correct value for bodies the integrator skips. Static and sleeping
bodies are the ones that get forgotten.

**Bug 4 — the scene, not the engine.** The first house-of-cards layout put one
horizontal card per *bay*, with card length 0.60 m and bay spacing 0.44 m, so
adjacent horizontal cards overlapped by 160 mm and started fully interpenetrated
through their 40 mm thickness. Rebuilt to match how the structure is actually
made: one flat card centred **on each apex**, with bay spacing slightly greater
than the card length so the flat cards do not touch, and the next tier's
A-frames straddling two adjacent flat cards. Support width under each flat card
is ~84 mm — the two outer top corners of the A-frame — which is realistically
narrow.

### The interesting part: how the two solvers responded to that bad scene

This turned into the sharpest behavioural difference measured in the whole
investigation, so it is worth recording even though it started as my bug.

Given a 40 mm initial interpenetration:

* **Sequential impulses** absorbed it. Its position pass corrects overlap with
  `BAUMGARTE = 0.2` per iteration, capped at `MAX_LINEAR_CORRECTION`, and
  crucially **does not touch velocities**. The structure unwound the overlap over
  ~0.5 s and settled with peak energy 1.3 J.
* **XPBD exploded.** Peak velocity was 25.7 m/s on the very first step and the
  scene reached 52 J. The cause is structural, not a coding error: XPBD recovers
  velocity as `v = (x - x_prev)/h`, so *any* positional correction is
  immediately converted into velocity. With 12 substeps, `h = 1.39 ms`, and a
  40 mm correction becomes `0.040 / 0.00139 = 28.8 m/s` — which matches the
  observed 25.7 m/s almost exactly.

That is the fundamental trade of the position-based formulation: making
constraint error and velocity the same quantity is what gives XPBD its excellent
penetration numbers *and* what makes it violent when handed a bad state. The
standard mitigation (used by Jolt, Avian, and most production XPBD codes, though
not in the original paper) is a maximum recovery speed. I added one, clamped to
`max(3 m/s, |v_n| at impact)` — principled because a contact should never eject
bodies faster than they arrived, and inert for resting contacts where the
per-substep depth is `~g*h^2`, twelve orders of magnitude below the clamp.

**Bug 5 — `addCard` silently dropped its `angle` argument.** The signature was
`addCard(world, cx, cy, angle, opts)` but the body was
`makeBox(cx, cy, hw, hh, opts)`. Every card in the house of cards was therefore
*vertical*, and the structure that appeared to "stand" was a stack of upright
planks with flat cards laid across them. The bug only became visible when I
rendered the scene to SVG and looked at it — no metric I was collecting would
ever have caught it, because a stack of upright planks is perfectly stable and
reports excellent numbers. Lesson: look at the thing.

**Bug 6 — flat cards buried in the A-frame corners.** A card tilted by θ does
not stand on the centre of its bottom face; it stands on one bottom corner,
`t·sin θ` lower. Symmetrically, the top corner it supports is `t·sin θ` above
the top face centre. Placing the tier floors using the apex height instead of
the corner height buried each flat card ~6 mm into the corner below it. The
correct tier pitch is `2L·cos θ + 2t·sin θ + clearance + 2t`.

Both of these are *scene* bugs, and both looked exactly like solver bugs. That
is why the suite now contains a check that no scene starts with more than 1 mm
of overlap anywhere — a cheap invariant that would have caught all three
geometry errors immediately.

**Bug 7 — stale broadphase after a scene change.** The sweep-and-prune keeps a
persistently sorted array of body references, and only rebuilt it when
`sorted.length !== bodies.length`. Switching from one scene to another with the
*same body count* therefore left the broadphase generating pairs among the
previous scene's bodies while the renderer drew the new ones — the new cards
free-fell out of view while contact points hung in mid-air in the shape of the
old structure. Fixed with an explicit `broadphase.reset()` from
`addBody`/`removeBody`/`clear`. Found by screenshotting the built page in
headless Chromium, which is worth doing for any deliverable that is a web page.

## Choosing the demo perturbation

First attempt was a 1.6 m/s flick on a bottom card. Both engines absorbed it
entirely. Raised it to 3.5 m/s plus 6 rad/s and it *still* only moved the card
about 95 mm. That is correct physics rather than solver stiffness: the structure
loads its own feet heavily, so the friction force resisting the flick is
proportional to everything stacked above, and the sliding distance
`v²/(2 μ g_eff)` is small. Both engines agreed, which is the tell that it was
physics rather than a bug.

Also learned that *which* card you kick matters: kicking an inward-facing foot
just jams the A-frame together. Switched the perturbation to **removing** a
bottom card, which is how a house of cards is actually knocked down, and is
unambiguous.

## Investigating why XPBD will not hold the card house

This took the longest and is the most interesting result, so the elimination
sequence is worth recording.

Isolated a bare A-frame (two leaning cards, no load) as the atomic test case.
Sequential impulses froze it exactly — angles constant to 2 decimal places from
t = 0.25 s onwards, foot position constant to 5 decimal places. XPBD *crept*:
the feet slid inwards ~4.5 mm over 1.5 s and both cards rotated by 1-2°, and
after ~5 s the pair had folded flat.

Hypotheses tested and eliminated:

1. **Friction cone too tight.** Ran μ = 0.75 against μ = 5. Drift changed from
   1.876° to 1.753° — i.e. essentially not at all. Not friction saturation.
2. **Dynamic-friction velocity pass injecting error.** Disabled `solveVelocities`
   entirely: 1.885° instead of 1.876°. Not it.
3. **Contact normal flip-flopping.** The apex is a corner-on-face contact
   between two thin bodies, a classic SAT degeneracy, so I logged the normal
   over 60 consecutive substeps. It was stable to three decimal places with a
   constant reference body. Not it.
4. **Gauss-Seidel ordering bias.** Both cards rotated the *same* direction, which
   smells like a systematic sweep-direction bias, so I tried symmetric
   Gauss-Seidel (alternating the sweep direction each substep). No improvement:
   108.6° vs 107.8° of drift at 5 s. Not it.
5. **Under-convergence.** Drift fell with *both* more iterations per substep
   (1.876° → 0.371°) and more substeps (24 substeps: 1.45°, and the pair then
   survived). This was the one that responded.

So the drift is a convergence property, and the natural next question is how it
scales. Measured time-to-collapse of the full house of cards against substep
count:

| substeps | collapses at | ms/step |
|---|---|---|
| 20 | 1.37 s | 0.67 |
| 40 | 1.85 s | 1.08 |
| 60 | 2.62 s | 1.40 |
| 100 | 3.65 s | 2.36 |
| 150 | 4.87 s | 3.65 |
| 200 | never (5 s) | 4.72 |
| 300 | never (8 s) | 7.25 |

Survival time is close to linear in substep count, i.e. the **drift rate is
first-order in the substep size h**. That is the honest statement of the result:
XPBD is convergent here, it is just that "converged enough to hold a marginally
stable structure indefinitely" costs roughly 300 substeps on this scene, or
~58x the cost of the sequential-impulse configuration that does the same job.

The contrast is structural rather than incidental. Sequential impulses with warm
starting has an actual **fixed point**: once the cached impulses exactly balance
gravity, the velocity solve returns zero correction, positions do not change,
and the same impulses are cached again next frame. The structure is then frozen
in the arithmetic, not merely slow-moving. Substepped XPBD has no such fixed
point — every substep re-integrates positions explicitly and re-projects, and
whatever asymmetric residual that leaves is re-injected as velocity by
`v = (x - x_prev)/h`.

(One anomaly: at 400 substeps the house fell again at 2.18 s, breaking the
monotone trend. `h = 42 μs` there and λ values are ~1e-9, so I suspect this is
round-off, but I did not chase it. Recorded as observed.)

## Contact caching across substeps in XPBD: tried and abandoned

Since per-substep narrowphase dominates XPBD's cost (20 substeps means 20 SAT
passes per frame), I implemented the obvious optimisation: run the narrowphase
once per frame, store each contact as a pair of local surface anchors plus the
normal in the reference body's frame, and re-derive depth from the live poses
each substep.

It was unreliable. Stale anchors produce a large bogus `(pA − pB)·n` once bodies
have rotated or slid appreciably, and the house of cards launched itself 700 m
into the air. Adding staleness guards (reject a contact once the anchors have
slid > 20 mm tangentially or report > 50 mm of depth) reduced it to 4.6 m of
launch — better, and still useless. Removed the code path rather than ship a
broken option. The finding stands as a cost note: per-substep narrowphase is not
an implementation detail of XPBD you can optimise away cheaply for tumbling thin
bodies; it is part of the price.

## Tunnelling

Neither engine does swept CCD. Measured the threshold by bisection — the fastest
a 0.2 m ball can travel and still be stopped by a 40 mm static wall:

* Sequential impulses: **> 400 m/s** (the search cap), i.e. 6.7 m of travel per
  step. This is not real CCD; it is a velocity-extended speculative contact —
  the broadphase inflates each AABB by `dt·|v|`, the narrowphase accepts
  separations up to `dt·(|v_A| + |v_B|)`, and the speculative bias
  `v_n ≥ −s/dt` then lets the body approach exactly far enough to touch and no
  further. It stops the body at the surface rather than resolving the true
  time of impact, so it can miss a thin body that is *between* two others, but
  for the single-obstacle case it is essentially free and extremely effective.
* Substepped XPBD: **22.3 m/s** at the default 20 substeps, i.e. 372 mm per
  frame or 18.6 mm per substep — about half the wall thickness, as expected.
  XPBD's answer to tunnelling is simply "add substeps", and the threshold scales
  linearly with them.

## Scene design errors worth recording

Two scenes were initially built past their own static limits, and both engines
correctly refused to hold them — which is a useful reminder that "the demo falls
over" is not evidence about the solver.

* **Corbel arch.** Step per course was 140 mm on 440 mm blocks over 9 courses.
  The centre of mass of everything above course *i* must stay over course *i*'s
  footprint, which caps the step at roughly `2·hw/courses` ≈ 49 mm. At 45 mm the
  arch stands (18 mm settle); at 140 mm it is simply an unstable pile.
* **Box tower.** At 16 boxes with 2 mm placement error the tower genuinely
  topples under both solvers. 13 boxes at 1.5 mm sits just inside the limit,
  which makes it a drift measurement instead of a collapse.
