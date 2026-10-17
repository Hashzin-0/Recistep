"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveStatus } from "@/lib/voice/live-config";
import {
  buildOrbGeometry,
  orbPalette,
  orbPulse,
  orbSpinSpeed,
  orbWaveAmplitude,
  ORB_VERTEX_WAVE_FREQUENCY,
  projectPoint,
  rotatePoint,
} from "@/lib/voice/orb-visuals";

const LONG_PRESS_MS = 700;
const LONG_PRESS_GRACE_MS = 300;
const MOVE_CANCEL_PX = 10;
const DEFAULT_SIZE = 132;
const MAX_DPR = 2;

export interface VoiceOrbProps {
  status: LiveStatus;
  userVolume: number;
  agentVolume: number;
  isMuted: boolean;
  /** Quando true o orb é um botão: clique desconecta e segurar silencia. */
  interactive?: boolean;
  size?: number;
  /** Rótulo acessível; obrigatório na prática quando `interactive` é true. */
  label?: string;
  onClick?: () => void;
  onLongPress?: () => void;
  className?: string;
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((char) => char + char).join("")
    : clean;
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return reduced;
}

export function VoiceOrb({
  status,
  userVolume,
  agentVolume,
  isMuted,
  interactive = false,
  size = DEFAULT_SIZE,
  label,
  onClick,
  onLongPress,
  className,
}: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const dynamicRef = useRef({ status, userVolume, agentVolume, isMuted });
  useEffect(() => {
    dynamicRef.current = { status, userVolume, agentVolume, isMuted };
  }, [status, userVolume, agentVolume, isMuted]);

  // Segurar o orb silencia; um clique curto desconecta.
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressRef = useRef(false);

  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!interactive) return;
      longPressRef.current = false;
      pressStartRef.current = { x: event.clientX, y: event.clientY };
      clearPressTimer();
      pressTimerRef.current = setTimeout(() => {
        pressTimerRef.current = null;
        longPressRef.current = true;
        onLongPress?.();
        if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
        graceTimerRef.current = setTimeout(() => {
          graceTimerRef.current = null;
        }, LONG_PRESS_GRACE_MS);
      }, LONG_PRESS_MS);
    },
    [clearPressTimer, interactive, onLongPress],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const start = pressStartRef.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) {
        clearPressTimer();
        pressStartRef.current = null;
      }
    },
    [clearPressTimer],
  );

  const handlePointerUp = useCallback(() => {
    clearPressTimer();
    pressStartRef.current = null;
  }, [clearPressTimer]);

  const handleClick = useCallback(() => {
    if (!interactive) return;
    if (longPressRef.current || graceTimerRef.current) {
      longPressRef.current = false;
      return;
    }
    onClick?.();
  }, [interactive, onClick]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!interactive) return;
      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        onLongPress?.();
      }
    },
    [interactive, onLongPress],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = Math.min(MAX_DPR, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const geometry = buildOrbGeometry();
    const center = size / 2;
    const unit = size * 0.28;
    const focus = 4.2;

    let rotation = 0;
    let tilt = -0.18;
    let frameId: number | null = null;
    let startTime = 0;

    const draw = (elapsedSeconds: number) => {
      const current = dynamicRef.current;
      const palette = orbPalette(current.status, { muted: current.isMuted });
      const pulse = reducedMotion
        ? 1
        : orbPulse(current.status, current.userVolume, current.agentVolume);
      const amplitude = reducedMotion
        ? 0
        : orbWaveAmplitude(current.status, current.userVolume, current.agentVolume);

      context.clearRect(0, 0, size, size);

      const glowRadius = unit * (2.1 + (pulse - 1) * 0.4);
      const glow = context.createRadialGradient(center, center, unit * 0.2, center, center, glowRadius);
      glow.addColorStop(0, withAlpha(palette.glow, 0.42));
      glow.addColorStop(0.55, withAlpha(palette.glow, 0.16));
      glow.addColorStop(1, withAlpha(palette.glow, 0));
      context.fillStyle = glow;
      context.beginPath();
      context.arc(center, center, glowRadius, 0, Math.PI * 2);
      context.fill();

      // Núcleo: esfera com brilho deslocado para dar volume.
      const coreRadius = unit * pulse;
      const core = context.createRadialGradient(
        center - coreRadius * 0.35,
        center - coreRadius * 0.4,
        coreRadius * 0.15,
        center,
        center,
        coreRadius,
      );
      core.addColorStop(0, withAlpha(palette.glow, 0.95));
      core.addColorStop(0.45, withAlpha(palette.core, 0.98));
      core.addColorStop(1, withAlpha(palette.core, 0.25));
      context.fillStyle = core;
      context.beginPath();
      context.arc(center, center, coreRadius, 0, Math.PI * 2);
      context.fill();

      // Vértices deformados pela onda; a amplitude acompanha o volume da voz.
      const displaced = geometry.vertices.map((vertex, index) => {
        const wave =
          Math.sin(vertex.x * ORB_VERTEX_WAVE_FREQUENCY + elapsedSeconds * 1.6 + index) *
          Math.cos(vertex.y * ORB_VERTEX_WAVE_FREQUENCY - elapsedSeconds * 1.3);
        const factor = 1 + amplitude * wave * 6;
        return { x: vertex.x * factor, y: vertex.y * factor, z: vertex.z * factor };
      });

      const projected = displaced.map((vertex) => {
        const rotated = rotatePoint(vertex, tilt, rotation);
        const point = projectPoint(rotated, focus);
        return {
          x: center + point.x * unit * 1.18,
          y: center + point.y * unit * 1.18,
          depth: point.depth,
        };
      });

      context.lineWidth = Math.max(1, size * 0.006);
      for (const [from, to] of geometry.edges) {
        const a = projected[from];
        const b = projected[to];
        const depth = (a.depth + b.depth) / 2;
        context.strokeStyle = withAlpha(palette.ring, 0.12 + depth * 0.5);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }

      for (const particle of geometry.particles) {
        const rotated = rotatePoint(particle, tilt, rotation * 0.6);
        const point = projectPoint(rotated, focus);
        const radius = Math.max(0.6, size * 0.006 * point.scale * (0.6 + point.depth));
        context.fillStyle = withAlpha(palette.particle, 0.15 + point.depth * 0.6);
        context.beginPath();
        context.arc(center + point.x * unit, center + point.y * unit, radius, 0, Math.PI * 2);
        context.fill();
      }

      // Dois anéis elípticos girando em eixos diferentes.
      const rings: Array<{ radius: number; squash: number; angle: number; alpha: number }> = [
        { radius: unit * 1.55, squash: 0.34, angle: rotation * 1.2, alpha: 0.5 },
        { radius: unit * 1.72, squash: 0.2, angle: -rotation * 0.9 + 0.6, alpha: 0.32 },
      ];
      for (const ring of rings) {
        context.strokeStyle = withAlpha(palette.ring, ring.alpha);
        context.lineWidth = Math.max(1, size * 0.005);
        context.beginPath();
        context.ellipse(center, center, ring.radius * pulse, ring.radius * ring.squash * pulse, ring.angle, 0, Math.PI * 2);
        context.stroke();
      }
    };

    if (reducedMotion) {
      draw(0);
      return;
    }

    const loop = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsedSeconds = (timestamp - startTime) / 1000;
      const current = dynamicRef.current;
      rotation += orbSpinSpeed(current.status);
      tilt = -0.18 + Math.sin(elapsedSeconds * 0.6) * 0.08;
      draw(elapsedSeconds);
      frameId = requestAnimationFrame(loop);
    };

    const start = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (frameId === null) return;
      cancelAnimationFrame(frameId);
      frameId = null;
    };

    const handleVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (typeof document !== "undefined" && document.hidden) {
      // Aba oculta: desenha um frame para não deixar o canvas vazio.
      draw(0);
    } else {
      start();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [size, reducedMotion, status, isMuted]);

  const canvas = (
    <canvas ref={canvasRef} className="voice-orb-canvas" aria-hidden="true" />
  );

  if (!interactive) {
    return (
      <div className={"voice-orb voice-orb-static " + (className ?? "")} style={{ width: size, height: size }} aria-hidden="true">
        {canvas}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={"voice-orb " + (className ?? "")}
      style={{ width: size, height: size }}
      aria-label={label}
      title={label}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {canvas}
    </button>
  );
}
