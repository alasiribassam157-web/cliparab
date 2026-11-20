"use client";

import { useEffect, useRef } from "react";

/**
 * Site-wide living background ("Neon future"): connected star network on a canvas, a perspective grid floor
 * moving toward the viewer, two drifting VYRA watermarks, a sweeping light beam and glowing orbs.
 * The canvas pauses when the tab is hidden and is skipped entirely with reduced motion.
 */
export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const x = c.getContext("2d");
    if (!x) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const css = getComputedStyle(document.documentElement);
    const colA = () => css.getPropertyValue("--primary").trim() || "#22d3ee";
    const colB = () => css.getPropertyValue("--accent").trim() || "#e879f9";
    let W = 0, H = 0, raf = 0;
    let P: { x: number; y: number; vx: number; vy: number; r: number; t: number; b: boolean }[] = [];
    const resize = () => {
      W = c.width = innerWidth * dpr; H = c.height = innerHeight * dpr;
      const n = Math.round(Math.min(70, (innerWidth * innerHeight) / 16000));
      P = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.25 * dpr, vy: (Math.random() - 0.5) * 0.25 * dpr, r: (0.6 + Math.random() * 1.8) * dpr, t: Math.random() * 6, b: Math.random() < 0.4 }));
    };
    resize();
    addEventListener("resize", resize);
    const link = 120 * dpr;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const A = colA(), B = colB();
      x.clearRect(0, 0, W, H);
      x.lineWidth = 0.6 * dpr;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        for (let j = i + 1; j < P.length; j++) {
          const q = P[j], d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < link) { x.globalAlpha = (1 - d / link) * 0.35; x.strokeStyle = A; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke(); }
        }
      }
      for (const p of P) {
        p.x += p.vx; p.y += p.vy; p.t += 0.03;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        x.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(p.t));
        x.fillStyle = p.b ? B : A;
        x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill();
      }
      x.globalAlpha = 1;
    };
    loop();
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); };
  }, []);
  return (
    <div className="backdrop" aria-hidden>
      <i className="bd-glow g1" /><i className="bd-glow g2" />
      <canvas ref={ref} className="bd-net" />
      <div className="bd-wm w1"><div>{"VYRA ".repeat(8)}</div></div>
      <div className="bd-wm w2"><div>{"VYRA ".repeat(8)}</div></div>
      <i className="bd-beam" /><i className="bd-orb o1" /><i className="bd-orb o2" />
      <div className="bd-floor" />
    </div>
  );
}
