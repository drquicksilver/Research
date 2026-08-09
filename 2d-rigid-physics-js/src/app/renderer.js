// Canvas renderer + debug draw. Shared by both builds.

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = { x: 0, y: 1.5, height: 4 };   // world units visible vertically
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.show = { contacts: false, normals: false, aabb: false, impulses: false, com: false };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.w = r.width; this.h = r.height;
  }

  get scale() { return this.h / this.camera.height; }

  toScreen(x, y) {
    const s = this.scale;
    return [(x - this.camera.x) * s + this.w / 2, this.h - (y - this.camera.y) * s - this.h / 2];
  }

  toWorld(px, py) {
    const s = this.scale;
    return {
      x: (px - this.w / 2) / s + this.camera.x,
      y: (this.h / 2 - py) / s + this.camera.y,
    };
  }

  fitTo(view) {
    this.camera.x = view.cx;
    this.camera.y = view.cy;
    this.camera.height = view.height;
  }

  draw(world) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this.drawGrid();

    for (const b of world.bodies) this.drawBody(ctx, b);

    if (this.show.aabb) {
      ctx.strokeStyle = 'rgba(120,200,255,0.35)';
      ctx.lineWidth = 1;
      for (const b of world.bodies) {
        const [x0, y0] = this.toScreen(b.aabb.minX, b.aabb.maxY);
        const [x1, y1] = this.toScreen(b.aabb.maxX, b.aabb.minY);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    if (this.show.contacts || this.show.normals || this.show.impulses) {
      const cs = world.debugContacts();
      let maxJ = 1e-9;
      for (const c of cs) if (c.impulse > maxJ) maxJ = c.impulse;
      for (const c of cs) {
        const [x, y] = this.toScreen(c.x, c.y);
        if (this.show.contacts) {
          // Persistent (warm-started) contacts are drawn differently from new
          // ones: a stack that is holding shows solid dots, a stack whose
          // manifolds keep being rebuilt shows flickering rings.
          ctx.fillStyle = c.warm ? '#ffd166' : '#ff6b6b';
          ctx.beginPath();
          ctx.arc(x, y, c.warm ? 2.6 : 2.0, 0, 6.2832);
          ctx.fill();
        }
        if (this.show.normals) {
          ctx.strokeStyle = 'rgba(255,209,102,0.8)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + c.nx * 14, y - c.ny * 14);
          ctx.stroke();
        }
        if (this.show.impulses && c.impulse > 0) {
          const l = 6 + 34 * Math.sqrt(c.impulse / maxJ);
          ctx.strokeStyle = 'rgba(120,220,160,0.85)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + c.nx * l, y - c.ny * l);
          ctx.stroke();
        }
      }
    }
  }

  drawGrid() {
    const ctx = this.ctx;
    const step = 1;
    const left = this.camera.x - (this.w / this.scale) / 2;
    const right = this.camera.x + (this.w / this.scale) / 2;
    const bottom = this.camera.y - this.camera.height / 2;
    const top = this.camera.y + this.camera.height / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(left / step) * step; x <= right; x += step) {
      const [sx] = this.toScreen(x, 0);
      ctx.moveTo(sx, 0); ctx.lineTo(sx, this.h);
    }
    for (let y = Math.floor(bottom / step) * step; y <= top; y += step) {
      const [, sy] = this.toScreen(0, y);
      ctx.moveTo(0, sy); ctx.lineTo(this.w, sy);
    }
    ctx.stroke();
  }

  drawBody(ctx, b) {
    const fill = b.isStatic ? '#39404f' : (b.color || '#c9d2e3');
    ctx.fillStyle = b.sleeping ? mixHex(fill, '#4a5060', 0.55) : fill;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;

    if (b.shape.type === 'poly') {
      const v = b.worldVerts;
      ctx.beginPath();
      let p = this.toScreen(v[0].x, v[0].y);
      ctx.moveTo(p[0], p[1]);
      for (let i = 1; i < v.length; i++) {
        p = this.toScreen(v[i].x, v[i].y);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      const [x, y] = this.toScreen(b.position.x, b.position.y);
      const r = b.shape.radius * this.scale;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
      ctx.stroke();
      // Spoke, so rolling versus sliding is visible.
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(b.angle) * r, y - Math.sin(b.angle) * r);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
    }

    if (this.show.com && !b.isStatic) {
      const [x, y] = this.toScreen(b.position.x, b.position.y);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }
}

function mixHex(a, b, t) {
  const pa = parseHex(a), pb = parseHex(b);
  if (!pa || !pb) return a;
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function parseHex(h) {
  if (typeof h !== 'string' || h[0] !== '#' || h.length !== 7) return null;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Small rolling strip chart for the metrics panel. */
export class Strip {
  constructor(canvas, color, label, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = color;
    this.label = label;
    this.data = [];
    this.max = opts.max || 0;
    this.log = !!opts.log;
    this.n = opts.n || 240;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  }
  push(v) {
    this.data.push(v);
    if (this.data.length > this.n) this.data.shift();
  }
  reset() { this.data.length = 0; }
  draw(unit = '') {
    const c = this.canvas, ctx = this.ctx;
    const r = c.getBoundingClientRect();
    if (c.width !== Math.round(r.width * this.dpr)) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = r.width, h = r.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, 0, w, h);

    let peak = this.max;
    for (const v of this.data) if (v > peak) peak = v;
    if (peak <= 0) peak = 1;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < this.data.length; i++) {
      const x = (i / (this.n - 1)) * w;
      const t = this.log ? Math.log10(1 + 9 * this.data[i] / peak) : this.data[i] / peak;
      const y = h - t * (h - 3) - 1.5;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(220,228,242,0.75)';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillText(`${this.label}  peak ${fmt(peak)}${unit}`, 5, 11);
  }
}

function fmt(v) {
  if (v === 0) return '0';
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}
