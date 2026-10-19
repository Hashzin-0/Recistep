// Geometria, paleta e projeção do orb de voz. Tudo aqui é puro e determinístico
// para poder ser testado no Vitest (ambiente node, sem canvas nem DOM): o
// componente apenas desenha o que estas funções calculam.

import type { LiveStatus } from "@/lib/voice/live-config";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface OrbPalette {
  core: string;
  glow: string;
  ring: string;
  particle: string;
}

export interface OrbGeometry {
  vertices: Vec3[];
  edges: Array<[number, number]>;
  particles: Vec3[];
}

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

const PALETTES: Record<LiveStatus, OrbPalette> = {
  idle: { core: "#4a4535", glow: "#8b8272", ring: "#8b8272", particle: "#f4efe4" },
  connecting: { core: "#46603a", glow: "#b8d762", ring: "#b8d762", particle: "#e9f6c8" },
  listening: { core: "#8fae3e", glow: "#cbe86c", ring: "#cbe86c", particle: "#f3ffcf" },
  thinking: { core: "#3f6b62", glow: "#83c8bb", ring: "#83c8bb", particle: "#d9f5ee" },
  speaking: { core: "#46603a", glow: "#9fd07a", ring: "#9fd07a", particle: "#e6f7d3" },
  error: { core: "#c4533c", glow: "#ff9d87", ring: "#ff9d87", particle: "#ffe1d8" },
};

const MUTED_PALETTE: OrbPalette = {
  core: "#3d3a34",
  glow: "#6f6a60",
  ring: "#6f6a60",
  particle: "#a8a297",
};

const AUDIO_PULSE_MAX = 1.6;
const VERTEX_WAVE_BASE: Record<LiveStatus, number> = {
  idle: 0.05,
  connecting: 0.06,
  listening: 0.16,
  thinking: 0.1,
  speaking: 0.22,
  error: 0.04,
};

export const ORB_VERTEX_WAVE_FREQUENCY = 4;

/** Volume que o orb deve seguir: a voz do agente quando ele fala, senão a do usuário. */
export function activeVolume(status: LiveStatus, userVolume: number, agentVolume: number): number {
  const raw = status === "speaking" ? agentVolume : userVolume;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(1, Math.max(0, raw));
}

export function orbPalette(status: LiveStatus, options?: { muted?: boolean }): OrbPalette {
  if (options?.muted) return MUTED_PALETTE;
  return PALETTES[status] ?? PALETTES.idle;
}

/** Fator multiplicativo do tamanho do orb (1 = repouso). */
export function orbPulse(status: LiveStatus, userVolume: number, agentVolume: number): number {
  const volume = activeVolume(status, userVolume, agentVolume);
  const response = status === "speaking" ? 1.8 : status === "listening" ? 0.9 : 0.35;
  return Math.min(AUDIO_PULSE_MAX, 1 + volume * response);
}

/** Amplitude da onda que deforma os vértices, com teto para não estourar o desenho. */
export function orbWaveAmplitude(status: LiveStatus, userVolume: number, agentVolume: number): number {
  const volume = activeVolume(status, userVolume, agentVolume);
  const base = VERTEX_WAVE_BASE[status] ?? VERTEX_WAVE_BASE.idle;
  return Math.min(0.4, base * orbPulse(status, userVolume, agentVolume) * (0.6 + volume));
}

/** Velocidade da rotação em radianos por frame (a 60 fps). */
export function orbSpinSpeed(status: LiveStatus): number {
  if (status === "thinking" || status === "connecting") return 0.035;
  if (status === "speaking") return 0.014;
  return 0.008;
}

export function rotatePoint(point: Vec3, rotationX: number, rotationY: number): Vec3 {
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const x1 = point.x * cosY + point.z * sinY;
  const z1 = -point.x * sinY + point.z * cosY;

  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  const y1 = point.y * cosX - z1 * sinX;
  const z2 = point.y * sinX + z1 * cosX;

  return { x: x1, y: y1, z: z2 };
}

/**
 * Projeção em perspectiva simples: converte um ponto 3D em coordenadas de tela
 * relativas ao centro do orb. `depth` é a profundidade normalizada (0 = atrás,
 * 1 = na frente) e `scale` é o quanto o ponto se aproxima da câmera.
 */
export function projectPoint(point: Vec3, focus = 4.2): ProjectedPoint {
  const scale = focus / (focus + point.z);
  return {
    x: point.x * scale,
    y: point.y * scale,
    depth: 1 - Math.min(1, Math.max(0, (point.z + 1.4) / 2.8)),
    scale,
  };
}

/** Gerador pseudoaleatório determinístico (LCG) para as partículas. */
function createRandom(seed: number): () => number {
  let state = (seed % 2147483647) || 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function normalize(point: Vec3): Vec3 {
  const length = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z) || 1;
  return { x: point.x / length, y: point.y / length, z: point.z / length };
}

/**
 * Icosaedro regular (12 vértices, 30 arestas) mais a nuvem de partículas que
 * orbita o núcleo. A mesma seed sempre produz a mesma geometria.
 */
export function buildOrbGeometry(options?: { seed?: number; particleCount?: number }): OrbGeometry {
  const seed = options?.seed ?? 42;
  const particleCount = Math.max(0, Math.min(400, options?.particleCount ?? 70));
  const golden = (1 + Math.sqrt(5)) / 2;

  const raw: Vec3[] = [
    { x: -1, y: golden, z: 0 },
    { x: 1, y: golden, z: 0 },
    { x: -1, y: -golden, z: 0 },
    { x: 1, y: -golden, z: 0 },
    { x: 0, y: -1, z: golden },
    { x: 0, y: 1, z: golden },
    { x: 0, y: -1, z: -golden },
    { x: 0, y: 1, z: -golden },
    { x: golden, y: 0, z: -1 },
    { x: golden, y: 0, z: 1 },
    { x: -golden, y: 0, z: -1 },
    { x: -golden, y: 0, z: 1 },
  ];
  const vertices = raw.map(normalize);

  // Duas arestas são unidas quando a distância angular entre os vértices é a
  // menor distância do icosaedro (aresta real, não diagonal).
  let minDistance = Number.POSITIVE_INFINITY;
  const distances: number[][] = vertices.map(() => []);
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      const dx = vertices[i].x - vertices[j].x;
      const dy = vertices[i].y - vertices[j].y;
      const dz = vertices[i].z - vertices[j].z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      distances[i][j] = distance;
      if (distance < minDistance) minDistance = distance;
    }
  }
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      if (distances[i][j] <= minDistance * 1.02) edges.push([i, j]);
    }
  }

  const random = createRandom(seed);
  const particles: Vec3[] = [];
  for (let i = 0; i < particleCount; i++) {
    const radius = 1.6 + random() * 0.9;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(random() * 2 - 1);
    particles.push({
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta),
      z: radius * Math.cos(phi),
    });
  }

  return { vertices, edges, particles };
}
