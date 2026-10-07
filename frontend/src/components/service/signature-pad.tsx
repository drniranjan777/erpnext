"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/** A finger / mouse signature box; reports a PNG data URL (null when cleared). */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
    };
    const down = (e: PointerEvent) => {
      drawing.current = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drawing.current) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      dirty.current = true;
    };
    const up = () => {
      if (!drawing.current) return;
      drawing.current = false;
      if (dirty.current) onChange(c.toDataURL("image/png"));
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointerleave", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointerleave", up);
    };
  }, [onChange]);
  function clear() {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  }
  return (
    <div>
      <canvas ref={canvas} width={480} height={140} className="w-full touch-none rounded-lg border border-border bg-white" aria-label="Customer signature" />
      <Button size="sm" variant="ghost" onClick={clear}>Clear signature</Button>
    </div>
  );
}
