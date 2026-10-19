"use client";

// Carrega a YouTube IFrame Player API uma única vez por documento. O script é
// injetado sob demanda para não impactar o carregamento inicial do app.

export type YouTubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate?(): number;
  destroy(): void;
};

export type YouTubeNamespace = {
  Player: new (element: HTMLElement | string, options: Record<string, unknown>) => YouTubePlayer;
  PlayerState: { UNSTARTED: number; ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loaderPromise: Promise<YouTubeNamespace> | null = null;

export function loadYouTubeIframeApi(): Promise<YouTubeNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("YOUTUBE_API_NO_WINDOW"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YOUTUBE_API_UNAVAILABLE"));
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("YOUTUBE_API_LOAD_FAILED"));
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
}
