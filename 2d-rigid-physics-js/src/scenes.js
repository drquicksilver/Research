// Demo scenes. Identical for both engines, built from a seeded RNG so the two
// solvers see bit-for-bit identical initial conditions.
//
// Everything is in SI units: metres, kilograms, seconds. Gravity is -9.81 m/s^2.
// The ground plane is y = 0.

import { Rng } from './core/math.js';
import { Body, makeBox, makeCircle, makeStaticBox, boxShape, resetBodyIds, STATIC } from './core/body.js';

const GROUND_FRICTION = 0.7;

function addGround(world, halfWidth = 8) {
  const g = makeStaticBox(0, -0.5, halfWidth, 0.5, { friction: GROUND_FRICTION, color: '#3a4252', label: 'ground' });
  world.addBody(g);
  return g;
}

// ---------------------------------------------------------------------------
// House of cards
// ---------------------------------------------------------------------------
//
// Card geometry. A real playing card is about 300:1 (89 mm x 0.3 mm) which no
// rigid body engine handles; 15:1 is the honest "thin plank" compromise, and is
// already thin enough to expose solver problems (see notes.md).
const CARD_HALF_LEN = 0.30;    // 0.60 m long
const CARD_HALF_THK = 0.02;    // 0.04 m thick  -> 15:1
const CARD_LEAN = 18 * Math.PI / 180;
const CARD_FRICTION = 0.75;
// Bay spacing is pinned by the real construction: each flat card spans one bay,
// so its ends land just inboard of two adjacent apexes, and adjacent flat cards
// butt end-to-end over each apex without overlapping. That forces
// spacing == card length (plus a hair of clearance). Any other value either
// starts the scene interpenetrated or leaves the flat cards unsupported.
const PAIR_SPACING = 2 * CARD_HALF_LEN + 0.004;   // 0.604 m
const BASE_CLEAR = 0.0005;                       // clearance under each card

function addCard(world, cx, cy, angle, opts) {
  return world.addBody(makeBox(cx, cy, CARD_HALF_THK, CARD_HALF_LEN,
                               Object.assign({ angle }, opts)));
}

/**
 * One A-frame: two cards leaning together, top corners nearly touching.
 * A small gap is left at the apex so the pair *settles* into contact rather
 * than starting interpenetrated — starting a scene inside a deep overlap would
 * measure the engines' recovery from a bad state, not their stacking quality.
 */
function addCardPair(world, cx, yBase, rng, opts) {
  const L = CARD_HALF_LEN, t = CARD_HALF_THK;
  const gap = 0.004;
  // Deterministic asymmetry: perfectly symmetric structures are a degenerate
  // special case (exact ties in SAT axis selection) and are not representative.
  const thetaL = CARD_LEAN + rng.sym(0.012);
  const thetaR = CARD_LEAN + rng.sym(0.012);
  // A tilted card stands on ONE bottom corner, which is t*sin(theta) below the
  // centre of its bottom face — so the centre has to be lifted by that much or
  // the card starts buried in whatever it is standing on.
  const yL = yBase + t * Math.sin(thetaL) + L * Math.cos(thetaL) + BASE_CLEAR;
  const yR = yBase + t * Math.sin(thetaR) + L * Math.cos(thetaR) + BASE_CLEAR;
  const left = addCard(world, cx - t * Math.cos(thetaL) - gap - L * Math.sin(thetaL), yL, -thetaL, opts);
  const right = addCard(world, cx + t * Math.cos(thetaR) + gap + L * Math.sin(thetaR), yR, thetaR, opts);
  return { left, right };
}

function houseOfCards(world, tiers = 4) {
  const rng = new Rng(20260808);
  addGround(world);
  const cardOpts = { friction: CARD_FRICTION, restitution: 0, density: 1, color: '#e8dcc0' };
  const flatOpts = { friction: CARD_FRICTION, restitution: 0, density: 1, color: '#d9c9a3' };

  // Height of the A-frame's outer top corner above the tier floor: the card is
  // lifted by t*sin(theta) so it stands on its low corner, and its high top
  // corner is another t*sin(theta) above the top face centre. Getting either
  // term wrong buries a card several millimetres into its neighbour at t = 0,
  // which detonates the structure on the first step.
  const cornerRise = 2 * CARD_HALF_LEN * Math.cos(CARD_LEAN)
                   + 2 * CARD_HALF_THK * Math.sin(CARD_LEAN) + BASE_CLEAR;
  const clearance = 0.003;
  const tierPitch = cornerRise + clearance + 2 * CARD_HALF_THK;
  const baseCount = tiers;
  let yBase = 0;

  for (let tier = 0; tier < tiers; tier++) {
    const count = baseCount - tier;
    const x0 = -(count - 1) * PAIR_SPACING * 0.5;
    for (let i = 0; i < count; i++) {
      addCardPair(world, x0 + i * PAIR_SPACING, yBase, rng, cardOpts);
    }
    // One flat card per bay. Each end rests on the nearer top corner of the
    // A-frame below it, so every apex carries two card ends — one from each
    // side — and the load on each A-frame stays balanced. The next tier's
    // A-frames then sit centred on these flat cards, feet well inside the span.
    for (let i = 0; i < count - 1; i++) {
      world.addBody(makeBox(x0 + (i + 0.5) * PAIR_SPACING,
                            yBase + cornerRise + clearance + CARD_HALF_THK,
                            CARD_HALF_LEN, CARD_HALF_THK, flatOpts));
    }
    yBase += tierPitch;
  }
  // Mark the topmost cards so the metrics code can watch the apex height.
  const maxY = Math.max(...world.bodies.filter((b) => !b.isStatic).map((b) => b.position.y));
  for (const b of world.bodies) if (!b.isStatic && b.position.y > maxY - 0.4) b.tracked = true;
}

/**
 * Kick the outermost foot of the lowest-left A-frame outwards — the way a real
 * house of cards is knocked down. Strong enough to be unambiguous: a nudge that
 * a stable solver simply absorbs makes for a useless collapse test.
 */
/**
 * Pull one card out of the bottom tier — the canonical way a house of cards
 * comes down, and a decisive perturbation.
 *
 * Kicking a card instead turned out to be a poor test: the structure loads its
 * own feet heavily, so friction absorbs even a 3.5 m/s flick within ~100 mm.
 * That is correct physics rather than solver stiffness (both engines agreed),
 * but it makes for a collapse test that never collapses.
 */
function pullBottomCard(world) {
  const cards = world.bodies.filter((b) => !b.isStatic);
  const lowest = Math.min(...cards.map((b) => b.position.y));
  const bottom = cards.filter((b) => b.position.y < lowest + 0.1);
  // Second A-frame from the left: removing an interior support drops the tier
  // above it, rather than just toppling the end of the structure.
  bottom.sort((a, b) => a.position.x - b.position.x);
  const target = bottom[Math.min(2, bottom.length - 1)];
  world.removeBody(target);
  world.wakeAll();
}

// ---------------------------------------------------------------------------
// Scene table
// ---------------------------------------------------------------------------

export const scenes = {
  houseOfCards: {
    name: 'House of cards',
    blurb: '4 tiers, 26 thin cards (15:1). Stands only if static friction holds at every apex and foot. The headline test.',
    view: { cx: 0, cy: 1.4, height: 3.6 },
    build(world) { houseOfCards(world, 4); },
    perturb(world) { pullBottomCard(world); },
    perturbLabel: 'Pull out a bottom card',
  },

  bigHouse: {
    name: 'House of cards (6 tiers)',
    blurb: 'Same construction scaled to 6 tiers / 66 cards. Contact graph is deep enough that solver convergence, not geometry, decides whether it stands.',
    view: { cx: 0, cy: 2.0, height: 5.0 },
    build(world) { houseOfCards(world, 6); },
    perturb(world) { pullBottomCard(world); },
    perturbLabel: 'Pull out a bottom card',
  },

  tower: {
    name: 'Box tower',
    blurb: '13 boxes stacked with a 1.5 mm placement error each — just inside the height at which the tower topples on its own. Measures lean drift in a long serial contact chain.',
    view: { cx: 0, cy: 2.1, height: 4.8 },
    build(world) {
      // 13 x 1.5 mm is deliberately close to the edge: at 14 boxes the tower
      // genuinely falls over under either solver, which is correct physics and
      // useless as a drift measurement.
      const rng = new Rng(7);
      addGround(world);
      const h = 0.15;
      for (let i = 0; i < 13; i++) {
        const b = makeBox(rng.sym(0.0015), h + i * (2 * h + 0.001), h, h, {
          friction: 0.6, restitution: 0, color: `hsl(${200 + i * 6} 45% ${45 + (i % 2) * 8}%)`,
          tracked: i >= 10,
        });
        world.addBody(b);
      }
    },
    perturb(world) {
      const top = world.bodies[world.bodies.length - 1];
      top.linearVelocity.x += 3.0;
      world.wakeAll();
    },
    perturbLabel: 'Shove the top box',
  },

  pyramid: {
    name: 'Box pyramid',
    blurb: '78 boxes, 12 wide at the base. A wide, heavily redundant contact graph — the case where Gauss-Seidel ordering artefacts show up.',
    view: { cx: 0, cy: 1.9, height: 4.6 },
    build(world) {
      const rng = new Rng(99);
      addGround(world);
      const h = 0.15, pitch = 2 * h + 0.005;
      const rows = 12;
      for (let r = 0; r < rows; r++) {
        const n = rows - r;
        const x0 = -(n - 1) * pitch * 0.5;
        for (let i = 0; i < n; i++) {
          world.addBody(makeBox(x0 + i * pitch + rng.sym(0.001), h + r * (2 * h + 0.001), h, h, {
            friction: 0.6, restitution: 0,
            color: `hsl(${20 + r * 8} 55% ${52 + (i % 2) * 6}%)`,
            tracked: r >= rows - 2,
          }));
        }
      }
    },
    perturb(world) {
      const ball = makeCircle(-4.5, 2.4, 0.22, { density: 6, friction: 0.4, restitution: 0.1, color: '#c94f4f' });
      ball.linearVelocity.x = 14;
      world.addBody(ball);
      world.wakeAll();
    },
    perturbLabel: 'Fire a cannonball',
  },

  dominoes: {
    name: 'Dominoes',
    blurb: '24 thin dominoes plus a rolling trigger. A travelling collapse wave: tests impulse propagation and thin-body contact quality.',
    view: { cx: 0, cy: 0.75, height: 2.0 },
    build(world) {
      addGround(world);
      const hw = 0.022, hh = 0.20;
      for (let i = 0; i < 24; i++) {
        world.addBody(makeBox(-2.6 + i * 0.22, hh, hw, hh, {
          friction: 0.55, restitution: 0,
          color: `hsl(${215 + (i % 3) * 10} 30% ${72 - (i % 2) * 8}%)`,
          tracked: i >= 22,
        }));
      }
    },
    perturb(world) {
      const ball = makeCircle(-3.4, 0.5, 0.1, { density: 4, friction: 0.4, restitution: 0.05, color: '#c94f4f' });
      ball.linearVelocity.x = 3.2;
      world.addBody(ball);
      world.wakeAll();
    },
    perturbLabel: 'Roll the trigger ball',
  },

  wall: {
    name: 'Brick wall',
    blurb: 'Staggered running-bond wall, 10 courses. Perturbed by a heavy projectile: a genuinely impulsive collapse rather than a quasi-static one.',
    view: { cx: 0, cy: 1.4, height: 3.6 },
    build(world) {
      const rng = new Rng(4242);
      addGround(world);
      const hw = 0.24, hh = 0.10;
      const pitch = 2 * hw + 0.006;   // > 2*hw, or the jitter starts bricks overlapping
      for (let r = 0; r < 10; r++) {
        const offset = (r % 2) ? pitch * 0.5 : 0;
        for (let i = -3; i <= 3; i++) {
          const x = i * pitch + offset;
          if (x - hw < -1.9 || x + hw > 1.9) continue;
          world.addBody(makeBox(x + rng.sym(0.0008), hh + r * (2 * hh + 0.001), hw, hh, {
            friction: 0.65, restitution: 0,
            color: `hsl(${12 + (r % 2) * 6} 42% ${46 + (i % 2) * 7}%)`,
            tracked: r >= 8,
          }));
        }
      }
    },
    perturb(world) {
      const ball = makeCircle(-4.0, 1.5, 0.28, { density: 9, friction: 0.3, restitution: 0.05, color: '#8d8f99' });
      ball.linearVelocity.x = 16;
      world.addBody(ball);
      world.wakeAll();
    },
    perturbLabel: 'Launch the wrecking ball',
  },

  friction: {
    name: 'Friction ramp (validation)',
    blurb: 'Blocks on a 25° ramp with μ = 0.20 / 0.40 / 0.60 / 0.80. Theory: slides iff μ < tan 25° = 0.466. The first two must slide, the last two must not.',
    view: { cx: 0, cy: 1.1, height: 3.0 },
    build(world) {
      addGround(world, 10);
      const ang = 25 * Math.PI / 180;
      const mus = [0.20, 0.40, 0.60, 0.80];
      for (let i = 0; i < mus.length; i++) {
        const mu = mus[i];
        const x0 = -3.6 + i * 2.4;
        const ramp = new Body({
          shape: boxShape(1.0, 0.05), x: x0, y: 0.9, angle: ang, type: STATIC,
          friction: mu, color: '#3a4252', label: `ramp ${mu}`,
        });
        world.addBody(ramp);
        // Block sits on the ramp surface, up-slope end.
        const bh = 0.12;
        const along = -0.5;
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        const tx = Math.cos(ang), ty = Math.sin(ang);
        world.addBody(makeBox(
          x0 + tx * along + nx * (0.05 + bh + 0.002),
          0.9 + ty * along + ny * (0.05 + bh + 0.002),
          bh, bh, {
            angle: ang, friction: mu, restitution: 0, tracked: true,
            color: mu < Math.tan(ang) ? '#c9705a' : '#5a9c78',
            label: `mu=${mu.toFixed(2)}`,
          }));
      }
    },
    perturb(world) { world.wakeAll(); },
    perturbLabel: 'Wake all',
  },

  arch: {
    name: 'Corbelled arch',
    blurb: 'A dry-stone corbel arch closed by a heavy capstone. Every block cantilevers over the one below, so the whole thing is a stack of overturning moments in near balance.',
    view: { cx: 0, cy: 1.1, height: 3.0 },
    build(world) {
      addGround(world);
      const rng = new Rng(555);
      const hw = 0.22, hh = 0.09;
      const courses = 9;
      // Corbel step is bounded by the classic overhang limit: the centre of
      // mass of everything above course i must stay over course i's footprint,
      // which caps the step at about 2*hw/courses. 45 mm leaves a small margin;
      // the first version used 140 mm and simply fell over, correctly.
      for (let r = 0; r < courses; r++) {
        const inset = 0.045 * r;
        for (const side of [-1, 1]) {
          const x = side * (0.9 - inset);
          world.addBody(makeBox(x + rng.sym(0.001), hh + r * (2 * hh + 0.001), hw, hh, {
            friction: 0.8, restitution: 0, color: `hsl(${35 + r * 3} 25% ${58 - r * 2}%)`,
            tracked: r >= courses - 2,
          }));
        }
      }
      // Capstone bridging the top of the corbel; twice the density of the
      // blocks, so it genuinely loads the structure.
      world.addBody(makeBox(0, hh + courses * (2 * hh + 0.001), 0.46, hh, {
        friction: 0.8, restitution: 0, density: 2, color: '#9a8f7a', tracked: true,
      }));
    },
    perturb(world) {
      const ball = makeCircle(0, 3.4, 0.2, { density: 8, friction: 0.5, restitution: 0.0, color: '#c94f4f' });
      world.addBody(ball);
      world.wakeAll();
    },
    perturbLabel: 'Drop a weight on the capstone',
  },
};

export const sceneKeys = Object.keys(scenes);

/** Build a scene into a fresh world. Body ids restart so both engines match. */
export function buildScene(world, key) {
  world.clear();
  resetBodyIds();
  const s = scenes[key] || scenes.houseOfCards;
  s.build(world);
  for (const b of world.bodies) b.updateTransform();
  return s;
}
