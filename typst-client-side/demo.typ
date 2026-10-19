// ============================================================
//  A tour of Typst, compiled entirely in your browser.
//  Edit anything on the left - the preview updates as you type.
// ============================================================

// ---------- Document set-up: metadata, page, text ----------
#set document(
  title: [A Tour of Typst],
  author: "Typst in the Browser",
  keywords: ("typst", "wasm", "demo"),
)

#let accent = rgb("#239dad")
#let ink = luma(25%)

#set page(
  paper: "a4",
  margin: (x: 2.2cm, top: 2.6cm, bottom: 2.4cm),
  header: context {
    // Introspection: no header on the title page.
    if here().page() > 1 {
      set text(8pt, fill: ink)
      smallcaps[A Tour of Typst]
      h(1fr)
      // The section starting on this page, else the last one before it.
      let all = query(heading.where(level: 1))
      let here-page = all.filter(h => h.location().page() == here().page())
      let before = all.filter(h => h.location().page() < here().page())
      if here-page.len() > 0 { here-page.first().body } else if before.len() > 0 { before.last().body }
      v(-4pt)
      line(length: 100%, stroke: 0.4pt + ink)
    }
  },
  numbering: "1 / 1",
  number-align: center,
)

#set text(font: "Libertinus Serif", size: 10.5pt, lang: "en")
#set par(justify: true, leading: 0.62em)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#set figure(gap: 0.8em)
#show link: set text(fill: accent)

// ---------- Show rules: restyle elements ----------
#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  set text(size: 20pt, weight: "bold", fill: accent)
  block(below: 1em)[
    #if it.numbering != none [
      #text(fill: ink.lighten(40%))[#counter(heading).display()]
      #h(0.4em)
    ]
    #it.body
  ]
}
#show heading.where(level: 2): set text(fill: ink, size: 13pt)
#show raw.where(block: true): block.with(
  fill: luma(96%),
  inset: 8pt,
  radius: 4pt,
  width: 100%,
)
#show raw.where(block: false): box.with(
  fill: luma(94%),
  inset: (x: 3pt),
  outset: (y: 3pt),
  radius: 2pt,
)
// Text show rule: every "Typst" gets the brand colour.
#show "Typst": name => text(fill: accent, weight: "semibold", name)

// ---------- Reusable components (functions!) ----------
#let callout(title: "Note", color: accent, body) = block(
  width: 100%,
  inset: 10pt,
  radius: 4pt,
  fill: color.lighten(88%),
  stroke: (left: 3pt + color),
)[
  #text(weight: "bold", fill: color.darken(20%), title) \
  #body
]

#let demo(code) = grid(
  columns: (1fr, 1fr),
  gutter: 10pt,
  align: horizon,
  raw(code.text, lang: "typ", block: true),
  block(inset: 8pt, stroke: 0.5pt + luma(80%), radius: 4pt, width: 100%,
    eval(code.text, mode: "markup")),
)

// ============================================================
//  Title page
// ============================================================
#page(numbering: none, margin: 0pt, header: none)[
  #place(top, rect(
    width: 100%,
    height: 62%,
    fill: gradient.linear(accent, rgb("#16214a"), angle: 60deg),
  ))
  // A field of translucent circles placed with a loop.
  #for i in range(14) {
    let x = calc.rem(i * 37, 100) * 1%
    let y = calc.rem(i * 53, 60) * 1%
    let r = 0.6cm + calc.rem(i * 7, 5) * 0.5cm
    place(top + left, dx: x, dy: y,
      circle(radius: r, fill: white.transparentize(88%)))
  }
  #place(top + left, dx: 2.2cm, dy: 7cm)[
    #set text(fill: white)
    #text(size: 42pt, weight: "bold")[A Tour of Typst] \
    #v(4pt)
    #text(size: 15pt)[Every feature on these pages was typeset by the \
      Typst compiler running as WebAssembly in your browser.]
  ]
  #place(bottom + left, dx: 2.2cm, dy: -2.5cm)[
    #set text(size: 11pt, fill: ink)
    #grid(
      columns: 2,
      column-gutter: 1.2em,
      row-gutter: 0.6em,
      [*Compiler*], [typst.ts 0.7 (Typst 0.14) → WebAssembly],
      [*Fonts*], [Libertinus Serif, New Computer Modern, DejaVu Sans Mono],
      [*Server*], [none: no source ever leaves this page],
      [*Date*], [#datetime(year: 2026, month: 10, day: 19).display("[day] [month repr:long] [year]")],
    )
  ]
]

#counter(page).update(1)

// ============================================================
#outline(indent: auto, depth: 2)
// ============================================================

= Markup <markup>

Typst's markup is designed to be as light as Markdown while being as
capable as LaTeX. Text can be _emphasised_, *strong*, or *_both_*. You can
write `inline code`, #underline[underline], #strike[strike through],
#overline[overline], #highlight[highlight], #smallcaps[Small Caps],
super#super[script] and sub#sub[script]. "Smart quotes" are 'automatic', as
are en--dashes, em---dashes and ellipses...

Links are written inline: https://typst.app, or with custom text:
#link("https://github.com/Myriad-Dreamin/typst.ts")[typst.ts on GitHub].
A line can be broken manually \
like this, and special characters like \#, \$ and \* are escaped with a
backslash. Unicode escapes work too: \u{1F600} is U+1F600.#footnote[Footnotes
are created with the `footnote` function and placed automatically at the
bottom of the page.]

== Lists

#grid(columns: (1fr, 1fr, 1.3fr), gutter: 12pt,
  [
    - Bullet lists
    - use a hyphen
      - and nest by
      - indentation
  ],
  [
    + Numbered lists
    + use a plus
      + numbering is
      + automatic
  ],
  [
    / Term: A definition list uses a slash.
    / Typst: A markup-based typesetting system.
  ],
)

#set enum(numbering: "(a)")
+ List numbering is customisable
+ with a pattern like `"(a)"`
#set enum(numbering: "1.")

== Labels, references and quotes

Every section, figure and equation can be labelled and referenced:
this is @markup, the maths is in @maths and the tables are in
@tbl-planets. References update automatically.

#quote(block: true, attribution: [Donald Knuth])[
  Beware of bugs in the above code; I have only proved it correct, not
  tried it.
]

== Markup and code side by side

The `eval` function means a document can show its own source next to the
result. The boxes on the right are compiled from the text on the left:

#demo(```
*Bold*, _italic_ and `raw`.
$a^2 + b^2 = c^2$
#text(fill: red)[Red text]
#box(width: 2cm, repeat[.])
```)

= Mathematics <maths>

Inline maths like $e^(i pi) + 1 = 0$ sits in the text, while display maths
gets its own line and, here, a number:

$ integral_(-oo)^oo e^(-x^2) dif x = sqrt(pi) $ <gauss>

@gauss is the Gaussian integral. Typst understands fractions, roots,
sums, products and limits:

$ sum_(k=1)^n k = (n(n+1)) / 2 quad
  product_(p "prime") 1 / (1 - p^(-s)) = zeta(s) quad
  lim_(x -> 0) (sin x) / x = 1 $

== Alignment, cases and matrices

$ f(x) &= (x + 1)^2 \
       &= x^2 + 2x + 1 $

$ |x| = cases(
    x & "if" x >= 0,
    -x & "otherwise",
  ) quad
  A = mat(1, 2, 3; 4, 5, 6; 7, 8, 9) quad
  det mat(a, b; c, d; delim: "|") = a d - b c $

$ vec(x_1, x_2, x_3) dot.op vec(y_1, y_2, y_3) = sum_i x_i y_i quad
  nabla times bold(E) = - (partial bold(B)) / (partial t) $

== Symbols, styles and decorations

$ alpha, beta, Gamma, Delta, aleph_0, planck, ell, nabla, partial, infinity $
$ NN subset ZZ subset QQ subset RR subset CC quad
  cal(L), frak(g), sans(A), mono(x), bb(1) $
$ hat(x), tilde(y), dot(z), arrow(v), overline(A B), x', f''(t) $
$ underbrace(1 + 2 + dots.c + n, n "terms") quad
  overbrace(a + b, "sum") quad cancel(x) / cancel(x) = 1 $
$ lr(chevron.l psi | phi.alt chevron.r) quad
  lr([ sum_(i=0)^n a_i ], size: #150%) quad
  A arrow.r.long B arrow.squiggly C $

#callout(title: "Maths font")[
  Equations use *New Computer Modern Math*. Every symbol above came from
  a font file loaded into the WebAssembly compiler at start-up.
]

= Code & Scripting <scripting>

== Raw blocks with syntax highlighting

```rust
fn main() {
    let typst = "compiled to wasm";
    println!("Hello from {typst}!");
}
```

```python
def fib(n: int) -> int:
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

```js
const svg = await renderer.renderSvg({ renderSession });
```

== A real programming language

Typst has variables, functions, closures, loops, conditionals, arrays,
dictionaries, strings, regular expressions and a maths library:

#let fib(n) = if n < 2 { n } else { fib(n - 1) + fib(n - 2) }
#let squares = range(1, 11).map(x => x * x)
#let person = (name: "Ada", born: 1815, field: "mathematics")

#table(
  columns: (auto, 1fr),
  stroke: none,
  row-gutter: 2pt,
  [`fib(20)`], [#fib(20)],
  [`squares`], [#squares.map(str).join(", ")],
  [`squares.filter(calc.even).sum()`], [#squares.filter(calc.even).sum()],
  [`person.name + " " + str(person.born)`], [#(person.name + " " + str(person.born))],
  [`calc.pow(2, 62)`], [#calc.pow(2, 62)],
  [`calc.round(calc.pi, digits: 6)`], [#calc.round(calc.pi, digits: 6)],
  [`"Hello world".split(" ").rev()`], [#repr("Hello world".split(" ").rev())],
  [`"a1b22c333".matches(regex("\d+"))`], [#"a1b22c333".matches(regex("\d+")).map(m => m.text).join(", ")],
  [`upper("typst")`], [#upper("typst")],
  [`numbering("I", 2026)`], [#numbering("I", 2026)],
  [`datetime.today()` _(type)_], [#type(datetime.today())],
)

Loops can produce content directly:

#for (i, colour) in (red, orange, yellow, green, blue, purple).enumerate() {
  box(circle(radius: 6pt + i * 1.5pt, fill: colour))
  h(4pt)
}

#let (x, y, ..rest) = (1, 2, 3, 4, 5)
Destructuring: `x = #x`, `y = #y`, `rest = #repr(rest)`.

== Show rules with regular expressions

#[
  #show regex("\b[A-Z]{2,}\b"): it => text(fill: purple, smallcaps(lower(it)))
  #show "wasm": [WebAssembly]
  Inside this block every ALL-CAPS word like HTML, PDF or SVG is restyled,
  and the word wasm is replaced by a longer one.
]

= Layout <layout>

== Grids, stacks and alignment

#grid(
  columns: (1fr, 2fr, 1fr),
  rows: (40pt, 40pt),
  gutter: 6pt,
  ..range(6).map(i => rect(
    width: 100%,
    height: 100%,
    fill: accent.lighten(30% + i * 10%),
    radius: 3pt,
    align(center + horizon, text(fill: white, weight: "bold")[Cell #(i + 1)]),
  ))
)

#stack(
  dir: ltr,
  spacing: 6pt,
  ..("left", "to", "right").map(w => box(stroke: accent, inset: 6pt, w)),
  h(1fr),
  rotate(-8deg, box(fill: yellow.lighten(40%), inset: 6pt)[rotated]),
  scale(x: 140%, y: 80%, origin: left)[scaled],
  h(20pt),
  skew(ax: -15deg)[skewed],
)

#align(center)[centred] #align(right)[right-aligned]

== Multiple columns

#columns(2, gutter: 14pt)[
  #set par(justify: true)
  Text can flow into several columns. #lorem(40)

  #colbreak()
  A `colbreak` forces the next column. #lorem(30)
]

== Placing and measuring

#box(width: 100%, height: 70pt, stroke: 0.5pt + luma(70%), radius: 4pt)[
  #place(top + left, dx: 6pt, dy: 6pt)[top-left]
  #place(center + horizon)[*`place` puts things anywhere*]
  #place(bottom + right, dx: -6pt, dy: -6pt)[bottom-right]
]

#context {
  let content = [Measure me!]
  let size = measure(content)
  [The phrase "#content" is #calc.round(size.width.pt(), digits: 1)pt wide
   and #calc.round(size.height.pt(), digits: 1)pt tall.]
}

#layout(available => [
  This paragraph knows that it has #calc.round(available.width.cm(), digits: 2)cm
  of horizontal space available.
])

= Tables & Figures <tables>

#figure(
  table(
    columns: (auto, 1fr, 1fr, 1fr),
    align: (left, right, right, right),
    stroke: (x, y) => if y == 0 { (bottom: 1pt + ink) } else { none },
    fill: (x, y) => if y > 0 and calc.even(y) { luma(95%) },
    inset: 6pt,
    table.header[*Planet*][*Radius (km)*][*Moons*][*Day (h)*],
    [Mercury], [2,440], [0], [4,222.6],
    [Venus], [6,052], [0], [2,802.0],
    [Earth], [6,371], [1], [24.0],
    [Mars], [3,390], [2], [24.7],
    [Jupiter], [69,911], [95], [9.9],
    table.hline(stroke: 0.5pt),
    table.cell(colspan: 2, align: center)[_Spans two columns_], [97], [—],
  ),
  caption: [Some planets of the Solar System.],
) <tbl-planets>

#figure(
  table(
    columns: 4,
    align: center + horizon,
    table.cell(rowspan: 2, fill: accent.lighten(70%))[*Row span*],
    table.cell(colspan: 3, fill: accent.lighten(85%))[*Column span*],
    [A], [B], [C],
    [1], [2], [3], [4],
  ),
  caption: [Cells can span rows and columns.],
)

== Data files

Typst can parse CSV, JSON, YAML, TOML and XML. Here a CSV string is
turned into a table and a bar chart built from plain boxes:

#let sales = csv(bytes("quarter,sales
Q1,42
Q2,67
Q3,58
Q4,91"), row-type: dictionary)

#let config = json(bytes(`{"product": "Widgets", "currency": "£"}`.text))

#figure(
  grid(
    columns: (auto, 1fr),
    gutter: 20pt,
    align: bottom,
    table(
      columns: 2,
      table.header[*Quarter*][*Sales*],
      ..sales.map(r => (r.quarter, config.currency + r.sales)).flatten()
    ),
    stack(
      dir: ltr,
      spacing: 8pt,
      ..sales.map(r => stack(
        spacing: 3pt,
        align(center, text(8pt, r.sales)),
        rect(width: 28pt, height: int(r.sales) * 1pt,
          fill: gradient.linear(accent, accent.darken(40%), angle: 90deg)),
        align(center, text(8pt, r.quarter)),
      ))
    ),
  ),
  caption: [#config.product sales, read from inline CSV and JSON.],
)

= Visualisation <shapes>

== Shapes, strokes and gradients

#stack(dir: ltr, spacing: 10pt,
  rect(width: 50pt, height: 35pt, fill: gradient.linear(..color.map.viridis)),
  circle(radius: 18pt, fill: gradient.radial(white, accent, focal-center: (30%, 30%))),
  ellipse(width: 55pt, height: 35pt, fill: gradient.conic(..color.map.rainbow)),
  square(size: 35pt, stroke: (paint: purple, thickness: 2pt, dash: "dashed")),
  polygon.regular(size: 40pt, vertices: 6, fill: orange.lighten(30%), stroke: orange.darken(30%)),
  polygon(fill: blue.lighten(60%), (0pt, 35pt), (20pt, 0pt), (40pt, 35pt), (20pt, 25pt)),
  rect(width: 45pt, height: 35pt, radius: (top-left: 15pt, bottom-right: 15pt), fill: green.lighten(50%)),
)

#stack(dir: ltr, spacing: 14pt,
  curve(
    stroke: 2pt + accent,
    curve.move((0pt, 30pt)),
    curve.cubic((20pt, -20pt), (40pt, 60pt), (60pt, 10pt)),
    curve.cubic(auto, (90pt, 50pt), (100pt, 20pt)),
  ),
  rect(width: 60pt, height: 35pt, fill: tiling(size: (8pt, 8pt))[
    #place(line(start: (0%, 0%), end: (100%, 100%), stroke: 0.6pt + accent))
  ]),
  line(length: 60pt, angle: -20deg, stroke: (paint: red, thickness: 3pt, cap: "round", dash: "dotted")),
)

== Colour spaces

#let swatch(c, label) = rect(width: 100%, height: 34pt, fill: c,
  align(center + horizon, text(7pt, fill: white, label)))
#grid(columns: 8,
  swatch(rgb("#d1495b"), "rgb"),
  swatch(oklch(70%, 0.15, 160deg), "oklch"),
  swatch(cmyk(80%, 30%, 0%, 10%), "cmyk"),
  swatch(color.hsl(270deg, 60%, 50%), "hsl"),
  swatch(color.mix(red, blue), "mix"),
  swatch(accent.darken(30%), "darken"),
  swatch(accent.rotate(120deg), "rotate"),
  swatch(luma(40%), "luma"),
)

#for map in (color.map.viridis, color.map.magma, color.map.turbo) {
  box(width: 100%, height: 8pt, fill: gradient.linear(..map))
  v(-6pt)
}

== Images

SVG, PNG, JPG, GIF and WebP images are supported. This one is an SVG held
in a string, so the whole document stays in a single file:

#let logo = bytes(```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <rect width="120" height="120" rx="24" fill="#239dad"/>
  <text x="60" y="84" font-size="72" text-anchor="middle"
        font-family="serif" fill="white">t</text>
  <circle cx="96" cy="26" r="10" fill="#f5c542"/>
</svg>
```.text)

#figure(
  stack(dir: ltr, spacing: 12pt,
    image(logo, width: 60pt),
    rotate(15deg, image(logo, width: 45pt)),
    box(clip: true, radius: 50%, image(logo, width: 60pt)),
  ),
  caption: [One SVG, drawn three ways.],
)

= Introspection <introspection>

== Counters and state

Custom counters and state can be updated and read anywhere in the
document. This document has
#context counter(heading).final().first() top-level sections,
#context counter(figure.where(kind: table)).final().first() tables and
#context counter(math.equation).final().first() numbered equation(s).

#let theorem = counter("theorem")
#let thm(body) = block(inset: 8pt, stroke: (left: 2pt + ink), width: 100%)[
  #theorem.step()
  *Theorem #context theorem.display().* #body
]

#thm[There are infinitely many primes.]
#thm[$sqrt(2)$ is irrational.]

#let mood = state("mood", "curious")
The state starts #context mood.get(),
#mood.update("delighted")
and becomes #context mood.get().

== Querying the document

#context {
  let figs = query(figure)
  [This document contains #figs.len() figures. Their captions are:]
  list(..figs.map(f => [#f.caption.body (page #f.location().page())]))
}

= Bibliography & Citations <bib>

Citations are written with `@key` or `#cite`: Typst was introduced in a
master's thesis @madje2022. Knuth's _TeXbook_ @knuth1984 and Lamport's
manual @lamport1994 describe its predecessors, and the citation style can
be changed with a single argument #cite(<knuth1984>, form: "prose").

== References

#bibliography(bytes(```
@book{knuth1984,
  title     = {The {TeX}book},
  author    = {Knuth, Donald E.},
  year      = {1984},
  publisher = {Addison-Wesley},
}
@book{lamport1994,
  title     = {{LaTeX}: A Document Preparation System},
  author    = {Lamport, Leslie},
  year      = {1994},
  edition   = {2},
  publisher = {Addison-Wesley},
}
@mastersthesis{madje2022,
  title  = {A Programmable Markup Language for Typesetting},
  author = {Mädje, Laurenz},
  school = {Technische Universität Berlin},
  year   = {2022},
}
```.text), style: "ieee", title: none)

= Typography <typography>

== Fonts, sizes and features

#text(font: "New Computer Modern")[This sentence is in New Computer Modern,]
#text(font: "DejaVu Sans Mono", size: 9pt)[this one in DejaVu Sans Mono,]
and this one is back in Libertinus Serif. Sizes go from
#text(7pt)[tiny] to #text(16pt)[large] and
#text(24pt, weight: "bold")[huge]. Weights: #text(weight: "regular")[regular],
#text(weight: "semibold")[semibold], #text(weight: "bold")[bold].
OpenType features: #text(number-type: "old-style")[old-style 0123456789],
#text(features: ("frac",))[1/2 3/4], #text(tracking: 3pt)[TRACKING],
ligatures fi fl ffi vs. #text(ligatures: false)[fi fl ffi].

== Languages and hyphenation

#set par(justify: true)
#columns(3, gutter: 10pt)[
  #set text(size: 9pt, hyphenate: true)
  #text(lang: "en")[*English.* Hyphenation follows the language of the
  text, so extraordinarily long words like incomprehensibilities break
  neatly.]
  #colbreak()
  #text(lang: "de")[*Deutsch.* Donaudampfschifffahrtsgesellschaftskapitän
  ist ein langes Wort, das korrekt nach deutschen Regeln getrennt wird.]
  #colbreak()
  #text(lang: "fr")[*Français.* Les guillemets « intelligents » et les
  espaces insécables s'adaptent à la langue choisie.]
]

== Paragraph and page control

#par(first-line-indent: (amount: 1.5em, all: true), justify: true)[
  This paragraph has a first-line indent and is fully justified. #lorem(35)
]

#align(center, box(width: 70%)[
  #set par(justify: false)
  #set align(center)
  _Centred text in a narrower box._ #lorem(20)
])

#v(1fr)
#line(length: 100%, stroke: 0.4pt + ink)
#align(center, text(9pt, fill: ink)[
  Made with Typst · #context counter(page).final().first() pages ·
  compiled in your browser
])
