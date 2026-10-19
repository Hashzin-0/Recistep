"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { VideoController, VideoPlayerState } from "@/lib/recipe/video-player";
import { formatVideoClock } from "@/lib/recipe/video-player";
import { youtubeVideoId, type VideoDisplay as VideoDisplayData } from "@/lib/recipe/video-display";
import { loadYouTubeIframeApi, type YouTubePlayer } from "@/lib/client/youtube-iframe";

const UNCONTROLLED_STATE: VideoPlayerState = {
  available: true,
  controllable: false,
  playing: false,
  current_time: 0,
  duration: 0,
  playback_rate: 1,
};

const PLATFORM_LABELS: Record<VideoDisplayData["platform"], string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

type Mode = "native" | "youtube" | "iframe" | "link";

function resolveMode(display: VideoDisplayData | null): Mode {
  if (!display) return "link";
  if (display.video_url) return "native";
  if (display.platform === "youtube" && display.embed_url) return "youtube";
  if (display.embed_url) return "iframe";
  return "link";
}

export type VideoDisplayProps = {
  display: VideoDisplayData | null;
  title?: string | null;
  className?: string;
  onStateChange?: (state: VideoPlayerState) => void;
};

export const VideoDisplay = forwardRef<VideoController, VideoDisplayProps>(function VideoDisplay(
  { display, title, className, onStateChange },
  ref,
) {
  const mode = resolveMode(display);
  const youtubeId = mode === "youtube" && display?.embed_url ? youtubeVideoId(display.embed_url) : null;

  const nativeRef = useRef<HTMLVideoElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<VideoController | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);

  const [ui, setUi] = useState<VideoPlayerState>(UNCONTROLLED_STATE);
  const [apiFailed, setApiFailed] = useState(false);

  // Objeto estável que delega ao controlador real; evita re-criar o handle a
  // cada montagem/desmontagem do player.
  const handleRef = useRef<VideoController>({
    play: () => controllerRef.current?.play() ?? false,
    pause: () => controllerRef.current?.pause() ?? false,
    toggle: () => controllerRef.current?.toggle() ?? false,
    seek: (seconds) => controllerRef.current?.seek(seconds) ?? false,
    seekBy: (delta) => controllerRef.current?.seekBy(delta) ?? false,
    setRate: (rate) => controllerRef.current?.setRate(rate) ?? false,
    getState: () => controllerRef.current?.getState() ?? { ...UNCONTROLLED_STATE, available: false },
  });
  useImperativeHandle(ref, () => handleRef.current, []);

  const publish = (state: VideoPlayerState) => {
    setUi(state);
    onStateChangeRef.current?.(state);
  };

  // --- Vídeo nativo (arquivo direto, controlável) ---------------------------
  useEffect(() => {
    if (mode !== "native") return;
    const video = nativeRef.current;
    if (!video) return;

    const controller: VideoController = {
      play: () => { void video.play().catch(() => undefined); return true; },
      pause: () => { video.pause(); return true; },
      toggle: () => { if (video.paused) void video.play().catch(() => undefined); else video.pause(); return true; },
      seek: (seconds) => { if (!Number.isFinite(seconds) || seconds < 0) return false; video.currentTime = seconds; return true; },
      seekBy: (delta) => { const next = video.currentTime + delta; if (!Number.isFinite(next)) return false; video.currentTime = Math.max(0, next); return true; },
      setRate: (rate) => { if (!Number.isFinite(rate) || rate <= 0) return false; video.playbackRate = Math.min(4, Math.max(0.25, rate)); return true; },
      getState: () => ({
        available: true,
        controllable: true,
        playing: !video.paused,
        current_time: video.currentTime || 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        playback_rate: video.playbackRate || 1,
      }),
    };
    controllerRef.current = controller;

    const sync = () => publish(controller.getState());
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("timeupdate", sync);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("ended", sync);
    video.addEventListener("ratechange", sync);
    sync();

    return () => {
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("ended", sync);
      video.removeEventListener("ratechange", sync);
      controllerRef.current = null;
    };
  }, [mode, display?.video_url]);

  // --- YouTube: IFrame API com controle (play/pause/seek) -------------------
  useEffect(() => {
    if (mode !== "youtube" || !youtubeId) return;
    let disposed = false;
    let player: YouTubePlayer | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (disposed || !hostRef.current) return;
        const playingState = YT.PlayerState.PLAYING;
        player = new YT.Player(hostRef.current, {
          videoId: youtubeId,
          host: "https://www.youtube-nocookie.com",
          playerVars: { rel: 0, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              if (disposed || !player) return;
              controllerRef.current = {
                play: () => { player?.playVideo(); return true; },
                pause: () => { player?.pauseVideo(); return true; },
                toggle: () => {
                  if (!player) return false;
                  if (player.getPlayerState() === playingState) player.pauseVideo();
                  else player.playVideo();
                  return true;
                },
                seek: (seconds) => { if (!Number.isFinite(seconds) || seconds < 0) return false; player?.seekTo(seconds, true); return true; },
                seekBy: (delta) => { if (!player) return false; const next = player.getCurrentTime() + delta; if (!Number.isFinite(next)) return false; player.seekTo(Math.max(0, next), true); return true; },
                setRate: (rate) => { if (!player || !Number.isFinite(rate) || rate <= 0) return false; player.setPlaybackRate(Math.min(2, Math.max(0.25, rate))); return true; },
                getState: () => ({
                  available: true,
                  controllable: true,
                  playing: player ? player.getPlayerState() === playingState : false,
                  current_time: player?.getCurrentTime() ?? 0,
                  duration: player?.getDuration() ?? 0,
                  playback_rate: player?.getPlaybackRate?.() ?? 1,
                }),
              };
              const sync = () => { if (controllerRef.current) publish(controllerRef.current.getState()); };
              sync();
              poll = setInterval(sync, 500);
            },
          },
        });
      })
      .catch(() => {
        if (!disposed) setApiFailed(true);
      });

    return () => {
      disposed = true;
      if (poll) clearInterval(poll);
      controllerRef.current = null;
      try { player?.destroy(); } catch { /* player já destruído */ }
    };
  }, [mode, youtubeId]);

  // --- iframe simples (sem controle) ---------------------------------------
  useEffect(() => {
    if (mode !== "iframe" && !(mode === "youtube" && apiFailed)) return;
    controllerRef.current = { ...noopFromUncontrolled() };
    publish(UNCONTROLLED_STATE);
  }, [mode, apiFailed]);

  const label = display ? PLATFORM_LABELS[display.platform] : "";
  const heading = title ? `Vídeo original: ${title}` : "Vídeo original";
  const seekMax = ui.duration > 0 ? ui.duration : 0;

  const wrapperClass = ["video-display", className].filter(Boolean).join(" ");

  return (
    <section className={wrapperClass} aria-label={heading}>
      <div className="video-display-heading">
        <strong>{heading}</strong>
        {display && <a href={display.watch_url} target="_blank" rel="noreferrer noopener">Abrir no {label}</a>}
      </div>

      {display && (mode === "native" || mode === "iframe" || mode === "youtube") && (
        <div className="video-display-frame">
          {mode === "native" && (
            <video ref={nativeRef} className="video-display-native" src={display.video_url ?? undefined} poster={display.thumbnail_url ?? undefined} controls playsInline preload="metadata" />
          )}
          {mode === "youtube" && !apiFailed && <div ref={hostRef} className="video-display-embed" />}
          {(mode === "iframe" || (mode === "youtube" && apiFailed)) && display.embed_url && (
            <iframe
              className="video-display-embed"
              src={display.embed_url}
              title={heading}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </div>
      )}

      {display && mode === "link" && display.thumbnail_url && (
        <a className="video-display-thumb" href={display.watch_url} target="_blank" rel="noreferrer noopener">
          <img src={display.thumbnail_url} alt={heading} />
        </a>
      )}

      {mode === "youtube" && !apiFailed && (
        <div className="video-display-controls">
          <button type="button" onClick={() => handleRef.current.toggle()} aria-label={ui.playing ? "Pausar vídeo" : "Reproduzir vídeo"}>
            {ui.playing ? "❚❚" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={seekMax || 1}
            step={1}
            value={Math.min(ui.current_time, seekMax || 1)}
            onChange={(event) => handleRef.current.seek(Number(event.target.value))}
            aria-label="Avançar no vídeo"
          />
          <span className="video-display-time">{formatVideoClock(ui.current_time)} / {formatVideoClock(ui.duration)}</span>
        </div>
      )}

      {display && !ui.controllable && (
        <p className="field-hint">Este formato de vídeo é reproduzido pela própria plataforma; o controle de reprodução por voz não está disponível.</p>
      )}
    </section>
  );
});

function noopFromUncontrolled(): VideoController {
  return {
    play: () => false,
    pause: () => false,
    toggle: () => false,
    seek: () => false,
    seekBy: () => false,
    setRate: () => false,
    getState: () => UNCONTROLLED_STATE,
  };
}
