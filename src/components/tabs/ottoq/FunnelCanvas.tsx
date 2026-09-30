// FunnelCanvas — draws the OTTO-Q funnel: the silhouette, every car in its layer, and each decision spark on its path.
//
// Motion is only ever between two real states: a car glides from the layer the last poll put it in to the layer this
// poll puts it in, and a spark travels the path its engine record names. The loop runs ONLY while something is moving,
// stops while the page is hidden, and with prefers-reduced-motion cars jump and sparks are drawn as a still mark. With
// the 3D depot running beside it, an idle funnel costs nothing.
import { useEffect, useRef } from "react";
import { LAYERS, type FunnelCar, type LayerId, type NodeTone, type Spark } from "@/lib/ottoqFunnel";
import { BAND_H, DOT_R, TONE_COLOR, bandOf, funnelHeight, layoutCars, sparkLaneX } from "./funnelGeometry";


const MOVE_MS = 1100;
const SPARK_MS = 1300;
/** New sparks are spread over this window, so a poll's batch reads as a stream, not one flash. */
const SPREAD_MS = 3500;

interface CarAnim { x: number; y: number; fx: number; fy: number; tx: number; ty: number; t0: number; tone: NodeTone }
interface SparkAnim { s: Spark; t0: number }

function reducedMotion(): boolean {
  try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch { return false; }
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function FunnelCanvas({ cars, sparks, selected, overflowLabel }: {
  cars: readonly FunnelCar[];
  /** Sparks to play: each is played once, the first time its key is seen. */
  sparks: readonly Spark[];
  selected: LayerId | null;
  overflowLabel?: (layer: LayerId, n: number) => string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useRef(0);
  const carAnims = useRef(new Map<string, CarAnim>());
  const sparkAnims = useRef<SparkAnim[]>([]);
  const played = useRef(new Set<string>());
  const overflow = useRef<Partial<Record<LayerId, number>>>({});
  const raf = useRef<number | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const draw = (now: number): boolean => {
    const c = canvas.current;
    const W = width.current;
    if (!c || W <= 0) return false;
    const ctx = c.getContext("2d");
    if (!ctx) return false;
    const dpr = window.devicePixelRatio || 1;
    const H = funnelHeight();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // ── silhouette: one smooth hourglass through every band's edges (straight inside a band, an S-curve between) ──
    const bands = LAYERS.map((l) => bandOf(l.id, W));
    const E = 10; // the straight run inside each band stops this far from its edge; the curve takes the rest
    const edge = (side: "x0" | "x1", order: typeof bands) => {
      order.forEach((b, i) => {
        const down = order[0].y0 < order[order.length - 1].y0;
        const yIn = down ? b.y0 + E : b.y1 - E, yOut = down ? b.y1 - E : b.y0 + E;
        if (i === 0) ctx.lineTo(b[side], down ? b.y0 : b.y1);
        else {
          const p = order[i - 1];
          const pEnd = down ? p.y1 - E : p.y0 + E;
          const mid = (pEnd + yIn) / 2;
          ctx.bezierCurveTo(p[side], mid, b[side], mid, b[side], yIn);
        }
        ctx.lineTo(b[side], yOut);
        if (i === order.length - 1) ctx.lineTo(b[side], down ? b.y1 : b.y0);
      });
    };
    ctx.beginPath();
    ctx.moveTo(bands[0].x0, bands[0].y0);
    edge("x0", bands);
    edge("x1", [...bands].reverse());
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(255,255,255,0.035)");
    g.addColorStop(0.3, "rgba(167,139,250,0.10)");
    g.addColorStop(0.6, "rgba(167,139,250,0.10)");
    g.addColorStop(1, "rgba(255,255,255,0.035)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // band dividers and the selected band
    bands.forEach((b, i) => {
      const think = LAYERS[i].kind === "think";
      if (selectedRef.current === b.id) {
        ctx.fillStyle = "rgba(200,16,46,0.14)";
        ctx.fillRect(b.x0 + 1, b.y0 + 1, b.x1 - b.x0 - 2, BAND_H - 2);
      }
      if (i > 0) {
        ctx.strokeStyle = think || LAYERS[i - 1].kind === "think" ? "rgba(167,139,250,0.22)" : "rgba(255,255,255,0.06)";
        ctx.beginPath();
        ctx.moveTo(Math.max(b.x0, bands[i - 1].x0) + 12, b.y0);
        ctx.lineTo(Math.min(b.x1, bands[i - 1].x1) - 12, b.y0);
        ctx.stroke();
      }
      if (think) {
        ctx.fillStyle = "rgba(196,181,253,0.5)";
        ctx.font = "600 8px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillText(LAYERS[i].label.toUpperCase(), b.cx, b.y1 - 6);
      }
    });

    let moving = false;
    const rm = reducedMotion();

    // ── cars ──
    for (const a of carAnims.current.values()) {
      const t = rm ? 1 : Math.min(1, (now - a.t0) / MOVE_MS);
      if (t < 1) moving = true;
      const k = ease(t);
      a.x = a.fx + (a.tx - a.fx) * k;
      a.y = a.fy + (a.ty - a.fy) * k;
      ctx.beginPath();
      ctx.arc(a.x, a.y, DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = TONE_COLOR[a.tone];
      ctx.fill();
    }
    for (const [layer, n] of Object.entries(overflow.current) as [LayerId, number][]) {
      if (!n) continue;
      const b = bandOf(layer, W);
      ctx.fillStyle = "rgba(231,234,240,0.7)";
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.fillText(overflowLabel ? overflowLabel(layer, n) : `+${n}`, b.x1 - 6, b.y0 + 10);
    }

    // ── sparks ──
    const alive: SparkAnim[] = [];
    for (const sa of sparkAnims.current) {
      const t = (now - sa.t0) / SPARK_MS;
      if (t < 0) { alive.push(sa); moving = true; continue; }
      if (t >= 1) continue;
      alive.push(sa);
      moving = true;
      const { s } = sa;
      const x = sparkLaneX(s.key, s.from, s.to, W);
      const fb = bandOf(s.from, W), tb = bandOf(s.to, W);
      const color = TONE_COLOR[s.tone];
      const fade = t > 0.8 ? (1 - t) / 0.2 : 1;
      ctx.globalAlpha = Math.max(0, fade);
      if (s.from === s.to || rm) {
        // a decision made and resolved inside one layer: a ring that opens where it happened
        const y = rm ? tb.cy : fb.cy;
        const r = rm ? 4 : 2 + 9 * ease(t);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const y0 = fb.cy, y1 = tb.cy;
        const k = ease(Math.min(1, t / 0.85));
        const y = y0 + (y1 - y0) * k;
        const tail = y0 + (y1 - y0) * Math.max(0, k - 0.18);
        const lg = ctx.createLinearGradient(x, tail, x, y);
        lg.addColorStop(0, "rgba(0,0,0,0)");
        lg.addColorStop(1, color);
        ctx.strokeStyle = lg;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, tail);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    sparkAnims.current = alive;
    return moving;
  };

  const kick = () => {
    if (raf.current != null) return;
    const step = (now: number) => {
      raf.current = null;
      if (typeof document !== "undefined" && document.hidden) return; // resumes on visibilitychange
      if (draw(now)) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  // Size to the container; redraw on resize.
  useEffect(() => {
    const el = wrap.current;
    const c = canvas.current;
    if (!el || !c) return;
    const fit = () => {
      const w = Math.floor(el.clientWidth);
      if (w === width.current) return;
      const oldW = width.current;
      width.current = w;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.floor(w * dpr));
      c.height = Math.floor(funnelHeight() * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${funnelHeight()}px`;
      // Re-lay cars in place on a resize: that is not motion, so they snap.
      if (oldW > 0) {
        const { pos, overflow: o } = layoutCars(carsRef.current, w);
        overflow.current = o;
        for (const [id, a] of carAnims.current) {
          const p = pos.get(id);
          if (!p) continue;
          a.x = a.fx = a.tx = p.x;
          a.y = a.fy = a.ty = p.y;
        }
      }
      kick();
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    const onVis = () => { if (!document.hidden) kick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ro?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cars: a new poll re-targets every car; one that moved glides from where it is.
  const carsRef = useRef(cars);
  carsRef.current = cars;
  useEffect(() => {
    const W = width.current;
    if (W <= 0) return;
    const now = performance.now();
    const { pos, overflow: o } = layoutCars(cars, W);
    overflow.current = o;
    const next = new Map<string, CarAnim>();
    for (const car of cars) {
      const p = pos.get(car.id);
      if (!p) continue;
      const prev = carAnims.current.get(car.id);
      if (!prev) {
        // First sight of a car is where the engine says it is: it did not "arrive" on screen.
        next.set(car.id, { x: p.x, y: p.y, fx: p.x, fy: p.y, tx: p.x, ty: p.y, t0: 0, tone: car.tone });
      } else if (prev.tx !== p.x || prev.ty !== p.y) {
        next.set(car.id, { ...prev, fx: prev.x, fy: prev.y, tx: p.x, ty: p.y, t0: now, tone: car.tone });
      } else {
        next.set(car.id, { ...prev, tone: car.tone });
      }
    }
    carAnims.current = next;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cars]);

  // Sparks: each key plays once, spread across the poll window.
  useEffect(() => {
    const fresh = sparks.filter((s) => !played.current.has(s.key));
    if (!fresh.length) return;
    const now = performance.now();
    const step = SPREAD_MS / Math.max(1, fresh.length);
    fresh.forEach((s, i) => {
      played.current.add(s.key);
      sparkAnims.current.push({ s, t0: now + i * step });
    });
    // Never let a burst grow without bound: the oldest sparks go first; cars are never dropped.
    if (sparkAnims.current.length > 60) sparkAnims.current = sparkAnims.current.slice(-60);
    if (played.current.size > 5000) played.current = new Set([...played.current].slice(-2500));
    kick();
    // kick is stable in effect (it reads refs only); the sparks are the dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sparks]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { kick(); }, [selected]);

  return (
    <div ref={wrap} className="relative w-full" style={{ height: funnelHeight() }}>
      <canvas ref={canvas} aria-hidden className="absolute inset-0" />
    </div>
  );
}
