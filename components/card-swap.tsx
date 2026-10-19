"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

// O track usa useLayoutEffect para medir a face ativa antes da pintura; no
// servidor caímos em useEffect para evitar o aviso de SSR do React.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type CardSwapFace = {
  id: string;
  label: string;
  content: ReactNode;
};

type CardSwapProps = {
  faces: CardSwapFace[];
  className?: string;
  ariaLabel?: string;
  onActiveIndexChange?: (index: number) => void;
};

const DRAG_INTENT_PX = 12;
const SWIPE_THRESHOLD_PX = 56;
const INTERACTIVE_SELECTOR = 'input, textarea, select, button, a, label, [contenteditable="true"]';

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
};

export function CardSwap({ faces, className, ariaLabel = "Modos de importação", onActiveIndexChange }: CardSwapProps) {
  const [index, setIndex] = useState(0);
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState<number>();

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const faceRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gestureRef = useRef<Gesture | null>(null);

  const lastIndex = faces.length - 1;

  useEffect(() => {
    onActiveIndexChange?.(index);
  }, [index, onActiveIndexChange]);

  const goTo = useCallback((next: number) => {
    setIndex((current) => {
      const clamped = Math.max(0, Math.min(lastIndex, next));
      return clamped === current ? current : clamped;
    });
    setDragPx(0);
  }, [lastIndex]);

  useIsomorphicLayoutEffect(() => {
    const face = faceRefs.current[index];
    if (!face) return;
    const update = () => setHeight(face.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(face);
    return () => observer.disconnect();
  }, [index, faces.length]);

  const releaseGesture = (pointerId: number) => {
    gestureRef.current = null;
    setDragging(false);
    setDragPx(0);
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    gestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.active) {
      if (Math.abs(dx) < DRAG_INTENT_PX || Math.abs(dx) < Math.abs(dy)) return;
      gesture.active = true;
      setDragging(true);
      viewportRef.current?.setPointerCapture(event.pointerId);
    }
    const atStart = index === 0 && dx > 0;
    const atEnd = index === lastIndex && dx < 0;
    setDragPx(atStart || atEnd ? dx * 0.35 : dx);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.active) {
      gestureRef.current = null;
      return;
    }
    const dx = event.clientX - gesture.startX;
    releaseGesture(event.pointerId);
    if (dx <= -SWIPE_THRESHOLD_PX) goTo(index + 1);
    else if (dx >= SWIPE_THRESHOLD_PX) goTo(index - 1);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    releaseGesture(event.pointerId);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(lastIndex, current + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = lastIndex;
    if (next === null) return;
    event.preventDefault();
    goTo(next);
    tabRefs.current[next]?.focus();
  };

  const trackClass = "card-swap-track" + (dragging ? " is-dragging" : "");

  return (
    <div className={["card-swap", className].filter(Boolean).join(" ")}>
      <div className="card-swap-header">
        <button
          type="button"
          className="card-swap-arrow"
          aria-label="Modo anterior"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
        >
          ‹
        </button>
        <div className="card-swap-tabs" role="tablist" aria-label={ariaLabel}>
          {faces.map((face, faceIndex) => (
            <button
              key={face.id}
              ref={(node) => { tabRefs.current[faceIndex] = node; }}
              type="button"
              role="tab"
              id={`card-swap-tab-${face.id}`}
              className={"card-swap-tab" + (faceIndex === index ? " is-active" : "")}
              aria-selected={faceIndex === index}
              aria-controls={`card-swap-panel-${face.id}`}
              tabIndex={faceIndex === index ? 0 : -1}
              onClick={() => goTo(faceIndex)}
              onKeyDown={(event) => handleTabKeyDown(event, faceIndex)}
            >
              {face.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="card-swap-arrow"
          aria-label="Próximo modo"
          onClick={() => goTo(index + 1)}
          disabled={index === lastIndex}
        >
          ›
        </button>
      </div>

      <div
        className="card-swap-viewport"
        ref={viewportRef}
        style={height !== undefined ? { height } : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className={trackClass} style={{ transform: `translateX(calc(${-index * 100}% + ${dragPx}px))` }}>
          {faces.map((face, faceIndex) => (
            <div
              key={face.id}
              ref={(node) => { faceRefs.current[faceIndex] = node; }}
              className="card-swap-face"
              role="tabpanel"
              id={`card-swap-panel-${face.id}`}
              aria-labelledby={`card-swap-tab-${face.id}`}
              aria-hidden={faceIndex !== index}
              inert={faceIndex !== index}
            >
              {face.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
