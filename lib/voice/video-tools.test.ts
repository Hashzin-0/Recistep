import { describe, expect, it } from "vitest";
import type { VideoController, VideoPlayerState } from "@/lib/recipe/video-player";
import type { VideoDisplay } from "@/lib/recipe/video-display";
import { executeVideoTool, type VideoStep, type VideoVoiceBridge } from "./video-tools";

const DISPLAY: VideoDisplay = {
  platform: "youtube",
  watch_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&rel=0",
  thumbnail_url: null,
  video_url: null,
  title: null,
  author_name: null,
};

function fakeController(controllable = true) {
  const state: VideoPlayerState = {
    available: true,
    controllable,
    playing: false,
    current_time: 30,
    duration: 600,
    playback_rate: 1,
  };
  const calls: string[] = [];
  const controller: VideoController = {
    play: () => { calls.push("play"); state.playing = true; return true; },
    pause: () => { calls.push("pause"); state.playing = false; return true; },
    toggle: () => { calls.push("toggle"); state.playing = !state.playing; return true; },
    seek: (seconds) => { calls.push("seek:" + seconds); state.current_time = seconds; return true; },
    seekBy: (delta) => { calls.push("seekBy:" + delta); state.current_time = Math.max(0, state.current_time + delta); return true; },
    setRate: (rate) => { calls.push("rate:" + rate); state.playback_rate = rate; return true; },
    getState: () => ({ ...state }),
  };
  return { controller, state, calls };
}

function bridge(options: {
  display?: VideoDisplay | null;
  controller?: VideoController | null;
  steps?: VideoStep[];
  currentStepPosition?: number;
  chosen?: number[];
} = {}): VideoVoiceBridge {
  const steps = options.steps ?? [
    { position: 0, instruction: "Mise en place", video_start_seconds: 0, video_end_seconds: 20 },
    { position: 1, instruction: "Misture", video_start_seconds: null, video_end_seconds: null },
    { position: 2, instruction: "Asse", video_start_seconds: 120, video_end_seconds: null },
  ];
  return {
    display: options.display === undefined ? DISPLAY : options.display,
    steps,
    currentStepPosition: options.currentStepPosition ?? 0,
    getController: () => (options.controller === undefined ? null : options.controller),
    chooseStep: (position) => options.chosen?.push(position),
    setNotice: () => undefined,
  };
}

const noop = () => undefined;

describe("executeVideoTool", () => {
  it("reports no video when the recipe has no source", () => {
    const output = executeVideoTool(bridge({ display: null }), "getVideoStatus", {}, noop);
    expect(output).toMatchObject({ success: true, has_video: false });
  });

  it("reports the playback state and the current step video mark", () => {
    const { controller } = fakeController();
    const output = executeVideoTool(bridge({ controller }), "getVideoStatus", {}, noop);
    expect(output).toMatchObject({
      success: true,
      has_video: true,
      platform: "youtube",
      controllable: true,
      playing: false,
      current_time: 30,
      current_time_label: "00:30",
      current_step: { step_number: 1, has_video_time: true, video_start_seconds: 0 },
    });
  });

  it("marks the video as not controllable for platform-only embeds", () => {
    const { controller } = fakeController(false);
    const output = executeVideoTool(bridge({ controller }), "getVideoStatus", {}, noop);
    expect(output).toMatchObject({ success: true, has_video: true, controllable: false });
    expect(executeVideoTool(bridge({ controller }), "playVideo", {}, noop)).toMatchObject({ success: false });
  });

  it("fails explicitly when there is no controller", () => {
    const output = executeVideoTool(bridge({ controller: null }), "playVideo", {}, noop);
    expect(output).toMatchObject({ success: false });
  });

  it("plays and pauses through the controller", () => {
    const { controller, calls } = fakeController();
    const play = executeVideoTool(bridge({ controller }), "playVideo", {}, noop);
    const pause = executeVideoTool(bridge({ controller }), "pauseVideo", {}, noop);
    expect(play).toMatchObject({ success: true, message: "Vídeo reproduzindo." });
    expect(pause).toMatchObject({ success: true, message: "Vídeo pausado." });
    expect(calls).toEqual(["play", "pause"]);
  });

  it("seeks to the step's marked time and selects it", () => {
    const { controller, calls } = fakeController();
    const chosen: number[] = [];
    const output = executeVideoTool(bridge({ controller, chosen }), "seekVideoToStep", { step_number: 3 }, noop);

    expect(output).toMatchObject({ success: true, step: { step_number: 3, video_start_seconds: 120 } });
    expect(chosen).toEqual([2]);
    expect(calls).toContain("seek:120");
  });

  it("refuses to seek when the step has no marked time", () => {
    const { controller } = fakeController();
    const output = executeVideoTool(bridge({ controller }), "seekVideoToStep", { step_number: 2 }, noop);
    expect(output).toMatchObject({ success: false });
  });

  it("navigates to the next step that has a video mark", () => {
    const { controller, calls } = fakeController();
    const chosen: number[] = [];
    const output = executeVideoTool(bridge({ controller, chosen, currentStepPosition: 0 }), "nextVideoStep", {}, noop);

    expect(output).toMatchObject({ success: true, step: { step_number: 3 } });
    expect(chosen).toEqual([2]);
    expect(calls).toEqual(["seek:120", "play"]);
  });

  it("fails when there is no further step with a video mark", () => {
    const { controller } = fakeController();
    const output = executeVideoTool(bridge({ controller, currentStepPosition: 2 }), "nextVideoStep", {}, noop);
    expect(output).toMatchObject({ success: false });
  });

  it("replays the last seconds with a clamped default", () => {
    const { controller, calls } = fakeController();
    const output = executeVideoTool(bridge({ controller }), "replayLastSeconds", {}, noop);
    expect(output).toMatchObject({ success: true });
    expect(calls).toEqual(["seekBy:-15", "play"]);
  });

  it("clamps the playback rate to the supported range", () => {
    const { controller, calls } = fakeController();
    executeVideoTool(bridge({ controller }), "setVideoPlaybackRate", { rate: 5 }, noop);
    expect(calls).toContain("rate:2");
  });
});
