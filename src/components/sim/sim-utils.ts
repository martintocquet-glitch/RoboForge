export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tokens {
  bg: string;
  panel: string;
  grid: string;
  fg: string;
  muted: string;
  primary: string;
  signal: string;
  success: string;
  warning: string;
  danger: string;
  border: string;
}

export function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v("--background"),
    panel: v("--panel"),
    grid: v("--grid"),
    fg: v("--foreground"),
    muted: v("--muted-foreground"),
    primary: v("--primary"),
    signal: v("--signal"),
    success: v("--success"),
    warning: v("--warning"),
    danger: v("--destructive"),
    border: v("--border"),
  };
}

/** Intersection rayon / rectangle (méthode des slabs). Retourne la distance ou Infinity. */
export function rayRect(ox: number, oy: number, dx: number, dy: number, r: Rect): number {
  const inv = (v: number) => (Math.abs(v) < 1e-9 ? 1e9 : 1 / v);
  const ix = inv(dx);
  const iy = inv(dy);
  const t1 = (r.x - ox) * ix;
  const t2 = (r.x + r.w - ox) * ix;
  const t3 = (r.y - oy) * iy;
  const t4 = (r.y + r.h - oy) * iy;
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
  if (tmax < 0 || tmin > tmax) return Infinity;
  return tmin >= 0 ? tmin : Infinity;
}

export function castRay(ox: number, oy: number, angle: number, maxRange: number, rects: Rect[]): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = maxRange;
  for (const r of rects) {
    const t = rayRect(ox, oy, dx, dy, r);
    if (t < best) best = t;
  }
  return best;
}

export function circleRect(cx: number, cy: number, rad: number, r: Rect): boolean {
  const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < rad * rad;
}

export function distToPolyline(px: number, py: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy || 1e-9;
    let t = ((px - ax) * vx + (py - ay) * vy) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
    if (d < best) best = d;
  }
  return best;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function setupCanvas(canvas: HTMLCanvasElement, worldW: number, worldH: number) {
  const parent = canvas.parentElement!;
  const cssW = parent.clientWidth;
  const cssH = (cssW * worldH) / worldW;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }
  const ctx = canvas.getContext("2d")!;
  const scale = (cssW / worldW) * dpr;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { ctx, scale, pxPerM: scale / dpr };
}

export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, step: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = step / 40;
  ctx.beginPath();
  for (let x = 0; x <= w + 1e-6; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y <= h + 1e-6; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

export function withAlpha(color: string, alpha: number): string {
  return `color-mix(in oklab, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
