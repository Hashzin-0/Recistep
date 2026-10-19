// Contrato imperativo que o player de vídeo expõe para o modo cozinha e para o
// assistente de voz. Módulo puro: descreve o controle sem depender de DOM/React.

export type VideoPlayerState = {
  /** Há um player montado (mesmo que não seja controlável). */
  available: boolean;
  /** Dá para enviar play/pause/seek (vídeo nativo ou YouTube). */
  controllable: boolean;
  playing: boolean;
  /** Posição atual em segundos. */
  current_time: number;
  /** Duração em segundos; 0 quando desconhecida. */
  duration: number;
  playback_rate: number;
};

export type VideoController = {
  play(): boolean;
  pause(): boolean;
  toggle(): boolean;
  seek(seconds: number): boolean;
  seekBy(deltaSeconds: number): boolean;
  setRate(rate: number): boolean;
  getState(): VideoPlayerState;
};

export function formatVideoClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00";
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}
