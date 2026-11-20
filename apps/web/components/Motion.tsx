"use client";

import { useEffect } from "react";
import { applyBrand } from "@/lib/brand";

/** Site-wide motion: scroll reveal for [data-reveal] and a cursor spotlight on .card. No effect with reduced motion. */
export function Motion() {
  useEffect(() => {
    const root = document.documentElement;
    applyBrand();
    root.classList.add("js");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    const scan = () => document.querySelectorAll<HTMLElement>("[data-reveal]:not(.in):not([data-seen])").forEach((el) => {
      el.setAttribute("data-seen", "1");
      if (reduce) el.classList.add("in"); else io.observe(el);
    });
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    const move = (ev: PointerEvent) => {
      const card = (ev.target as Element | null)?.closest?.(".card") as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      card.style.setProperty("--my", `${ev.clientY - r.top}px`);
    };
    if (!reduce) document.addEventListener("pointermove", move, { passive: true });
    return () => { io.disconnect(); mo.disconnect(); document.removeEventListener("pointermove", move); root.classList.remove("js"); };
  }, []);
  return null;
}
