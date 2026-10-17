import { describe, expect, it } from "vitest";
import {
  activeVolume,
  buildOrbGeometry,
  orbPalette,
  orbPulse,
  orbSpinSpeed,
  orbWaveAmplitude,
  projectPoint,
  rotatePoint,
} from "@/lib/voice/orb-visuals";
import type { LiveStatus } from "@/lib/voice/live-config";

const STATUSES: LiveStatus[] = [
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "error",
];

function length(point: { x: number; y: number; z: number }): number {
  return Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z);
}

describe("orbPalette", () => {
  it("devolve uma paleta completa para cada estado", () => {
    for (const status of STATUSES) {
      const palette = orbPalette(status);
      expect(palette.core).toMatch(/^#[0-9a-f]{6}$/);
      expect(palette.glow).toMatch(/^#[0-9a-f]{6}$/);
      expect(palette.ring).toMatch(/^#[0-9a-f]{6}$/);
      expect(palette.particle).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("usa cores diferentes para ouvir, pensar e falar", () => {
    const listening = orbPalette("listening").core;
    const thinking = orbPalette("thinking").core;
    const speaking = orbPalette("speaking").core;
    expect(new Set([listening, thinking, speaking]).size).toBe(3);
  });

  it("usa uma paleta neutra quando o microfone está silenciado", () => {
    const muted = orbPalette("speaking", { muted: true });
    expect(muted.core).toBe(orbPalette("idle", { muted: true }).core);
    expect(muted.core).not.toBe(orbPalette("speaking").core);
  });
});

describe("activeVolume", () => {
  it("segue a voz do agente apenas enquanto ele fala", () => {
    expect(activeVolume("speaking", 0.2, 0.9)).toBe(0.9);
    expect(activeVolume("listening", 0.2, 0.9)).toBe(0.2);
  });

  it("limita o volume ao intervalo 0..1", () => {
    expect(activeVolume("listening", 2, 0)).toBe(1);
    expect(activeVolume("listening", -1, 0)).toBe(0);
    expect(activeVolume("listening", Number.NaN, 0)).toBe(0);
  });
});

describe("orbPulse", () => {
  it("fica em 1 no silêncio e cresce com o volume", () => {
    expect(orbPulse("idle", 0, 0)).toBe(1);
    expect(orbPulse("speaking", 0.5, 0.8)).toBeGreaterThan(1);
  });

  it("é maior falando do que ouvindo com o mesmo volume", () => {
    expect(orbPulse("speaking", 0.3, 0.3)).toBeGreaterThan(orbPulse("listening", 0.3, 0.3));
  });

  it("nunca passa do teto de 1.6", () => {
    for (const status of STATUSES) {
      expect(orbPulse(status, 1, 1)).toBeLessThanOrEqual(1.6);
    }
  });
});

describe("orbWaveAmplitude", () => {
  it("fica dentro dos limites do desenho", () => {
    for (const status of STATUSES) {
      const amplitude = orbWaveAmplitude(status, 1, 1);
      expect(amplitude).toBeGreaterThanOrEqual(0);
      expect(amplitude).toBeLessThanOrEqual(0.4);
    }
  });

  it("aumenta quando há voz", () => {
    expect(orbWaveAmplitude("listening", 0.9, 0)).toBeGreaterThan(orbWaveAmplitude("listening", 0, 0));
  });
});

describe("orbSpinSpeed", () => {
  it("gira mais rápido pensando do que parado", () => {
    expect(orbSpinSpeed("thinking")).toBeGreaterThan(orbSpinSpeed("speaking"));
    expect(orbSpinSpeed("speaking")).toBeGreaterThan(orbSpinSpeed("idle"));
    expect(orbSpinSpeed("error")).toBe(orbSpinSpeed("idle"));
  });
});

describe("rotatePoint", () => {
  it("não altera a origem", () => {
    expect(rotatePoint({ x: 0, y: 0, z: 0 }, 0.7, 1.2)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("preserva o comprimento do vetor", () => {
    const point = { x: 0.3, y: -0.5, z: 0.8 };
    expect(length(rotatePoint(point, 0.4, 1.1))).toBeCloseTo(length(point), 6);
  });

  it("gira 90° em Y levando X para Z", () => {
    const rotated = rotatePoint({ x: 1, y: 0, z: 0 }, 0, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0, 6);
    expect(rotated.z).toBeCloseTo(-1, 6);
  });

  it("é determinístico para os mesmos ângulos", () => {
    const point = { x: -0.2, y: 0.6, z: 0.1 };
    expect(rotatePoint(point, 0.9, -0.3)).toEqual(rotatePoint(point, 0.9, -0.3));
  });
});

describe("projectPoint", () => {
  it("aproxima os pontos da frente", () => {
    const near = projectPoint({ x: 0, y: 0, z: -0.5 });
    const far = projectPoint({ x: 0, y: 0, z: 0.5 });
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.depth).toBeGreaterThan(far.depth);
  });

  it("mantém profundidade normalizada em 0..1", () => {
    for (const z of [-5, -1.4, 0, 1.4, 5]) {
      const point = projectPoint({ x: 0.2, y: 0.2, z });
      expect(point.depth).toBeGreaterThanOrEqual(0);
      expect(point.depth).toBeLessThanOrEqual(1);
    }
  });
});

describe("buildOrbGeometry", () => {
  it("produz um icosaedro com 12 vértices e 30 arestas", () => {
    const geometry = buildOrbGeometry();
    expect(geometry.vertices).toHaveLength(12);
    expect(geometry.edges).toHaveLength(30);
  });

  it("normaliza os vértices na esfera unitária", () => {
    for (const vertex of buildOrbGeometry().vertices) {
      expect(length(vertex)).toBeCloseTo(1, 6);
    }
  });

  it("não repete arestas nem liga um vértice a si mesmo", () => {
    const { edges } = buildOrbGeometry();
    const keys = new Set(edges.map(([a, b]) => `${a}-${b}`));
    expect(keys.size).toBe(edges.length);
    for (const [a, b] of edges) {
      expect(a).not.toBe(b);
      expect(a).toBeLessThan(b);
    }
  });

  it("gera a nuvem de partículas padrão", () => {
    const geometry = buildOrbGeometry();
    expect(geometry.particles).toHaveLength(70);
    for (const particle of geometry.particles) {
      expect(length(particle)).toBeGreaterThanOrEqual(1.6);
      expect(length(particle)).toBeLessThanOrEqual(2.5);
    }
  });

  it("é determinístico para a mesma seed e muda com outra seed", () => {
    expect(buildOrbGeometry({ seed: 7 })).toEqual(buildOrbGeometry({ seed: 7 }));
    expect(buildOrbGeometry({ seed: 7 }).particles).not.toEqual(buildOrbGeometry({ seed: 8 }).particles);
  });

  it("limita a quantidade de partículas", () => {
    expect(buildOrbGeometry({ particleCount: -10 }).particles).toHaveLength(0);
    expect(buildOrbGeometry({ particleCount: 10_000 }).particles).toHaveLength(400);
  });
});
