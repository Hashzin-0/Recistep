"use client";

// Audio format for Gemini Live: microphone sends 16 kHz 16-bit mono PCM and
// the model replies with 24 kHz 16-bit mono PCM.
//
// Ports the audio engine of the reference voice agent (Hashzin-0/N-simple)
// without its noise gate, which Recistep does not need.

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const FALLBACK_BUFFER_SIZE = 4_096;

function closeContext(context: AudioContext): void {
  if (!isClosed(context)) context.close().catch(() => undefined);
}

// Chamada em funções onde o narrowing do TypeScript já descarta "closed",
// mesmo que na runtime o contexto possa ser fechado por outra ação.
function isClosed(context: AudioContext): boolean {
  return context.state === "closed";
}

function float32ToBase64(samples: Float32Array): string {
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const samples = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) samples[i] = pcm16[i] / 0x8000;
  return samples;
}

export class AudioStreamer {
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private inputWorklet: AudioWorkletNode | null = null;
  private inputFallback: ScriptProcessorNode | null = null;
  private playbackWorklet: AudioWorkletNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;

  private recording = false;
  private starting = false;
  private aborted = false;
  private workletPlayback = false;

  private onChunk: ((base64Pcm: string) => void) | null = null;
  private onUserVolume: ((volume: number) => void) | null = null;
  private onAgentVolume: ((volume: number) => void) | null = null;
  private monitorHandle: number | null = null;

  async ensureOutputContext(): Promise<AudioContext> {
    if (!this.outputContext || isClosed(this.outputContext)) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioContextClass({ sampleRate: OUTPUT_SAMPLE_RATE });
      this.outputContext = context;

      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyser.connect(context.destination);
      this.outputAnalyser = analyser;

      if (context.audioWorklet && "addModule" in context.audioWorklet) {
        try {
          await context.audioWorklet.addModule("/audio-processors/playback.worklet.js");
          if (this.outputContext === context && !isClosed(context)) {
            const node = new AudioWorkletNode(context, "pcm-processor");
            node.connect(analyser);
            this.playbackWorklet = node;
            this.workletPlayback = true;
          }
        } catch {
          this.workletPlayback = false;
        }
      }
    }

    const context = this.outputContext;
    if (context.state === "suspended") await context.resume();
    return context;
  }

  async startRecording(
    onChunk: (base64Pcm: string) => void,
    onUserVolume?: (volume: number) => void,
    onAgentVolume?: (volume: number) => void,
  ): Promise<void> {
    if (this.recording || this.starting) return;
    this.starting = true;
    this.aborted = false;

    try {
      this.onChunk = onChunk;
      this.onUserVolume = onUserVolume ?? null;
      this.onAgentVolume = onAgentVolume ?? null;

      await this.ensureOutputContext();
      if (this.aborted) return;

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioContextClass({ sampleRate: INPUT_SAMPLE_RATE });
      this.inputContext = context;
      if (context.state === "suspended") await context.resume();
      if (this.aborted || isClosed(context)) {
        closeContext(context);
        if (this.inputContext === context) this.inputContext = null;
        return;
      }

      const mediaStream = await this.openMicrophone();
      if (this.aborted || isClosed(context)) {
        mediaStream.getTracks().forEach((track) => track.stop());
        closeContext(context);
        if (this.inputContext === context) this.inputContext = null;
        return;
      }
      this.mediaStream = mediaStream;

      const source = context.createMediaStreamSource(mediaStream);
      this.inputSource = source;

      const handleSamples = (samples: Float32Array) => this.processChunk(samples);

      let usingWorklet = false;
      if (context.audioWorklet && "addModule" in context.audioWorklet) {
        try {
          await context.audioWorklet.addModule("/audio-processors/capture.worklet.js");
          usingWorklet = !isClosed(context) && !this.aborted;
        } catch {
          usingWorklet = false;
        }
      }

      if (usingWorklet && !isClosed(context) && !this.aborted) {
        try {
          const node = new AudioWorkletNode(context, "audio-capture-processor");
          node.port.onmessage = (event: MessageEvent<{ type: string; data: Float32Array }>) => {
            if (!this.recording || event.data?.type !== "audio") return;
            handleSamples(event.data.data);
          };
          source.connect(node);
          this.inputWorklet = node;
          this.recording = true;
          this.startVolumeMonitor();
          return;
        } catch {
          this.inputWorklet = null;
        }
      }

      if (this.aborted || isClosed(context)) {
        source.disconnect();
        this.inputSource = null;
        mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
        closeContext(context);
        if (this.inputContext === context) this.inputContext = null;
        return;
      }

      const fallback = context.createScriptProcessor(FALLBACK_BUFFER_SIZE, 1, 1);
      fallback.onaudioprocess = (event: AudioProcessingEvent) => {
        if (!this.recording) return;
        handleSamples(event.inputBuffer.getChannelData(0));
      };
      source.connect(fallback);
      fallback.connect(context.destination);
      this.inputFallback = fallback;
      this.recording = true;
      this.startVolumeMonitor();
    } finally {
      this.starting = false;
    }
  }

  private async openMicrophone(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          sampleRate: { ideal: INPUT_SAMPLE_RATE },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }

  private processChunk(samples: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, samples.length));
    this.onUserVolume?.(Math.min(1, rms * 5));
    this.onChunk?.(float32ToBase64(samples));
  }

  stopRecording(): void {
    this.aborted = true;
    this.recording = false;

    if (this.inputWorklet) {
      this.inputWorklet.disconnect();
      this.inputWorklet = null;
    }
    if (this.inputFallback) {
      this.inputFallback.disconnect();
      this.inputFallback.onaudioprocess = null;
      this.inputFallback = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.inputContext) closeContext(this.inputContext);
    this.inputContext = null;
    if (this.monitorHandle !== null) {
      cancelAnimationFrame(this.monitorHandle);
      this.monitorHandle = null;
    }
    this.onUserVolume?.(0);
  }

  async playPcmChunk(base64Pcm: string): Promise<void> {
    const context = await this.ensureOutputContext();
    if (isClosed(context)) return;

    const samples = base64ToFloat32(base64Pcm);

    if (this.workletPlayback && this.playbackWorklet) {
      this.playbackWorklet.port.postMessage(samples);
      return;
    }

    const buffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputAnalyser ?? context.destination);

    const now = context.currentTime;
    if (this.nextPlayTime < now) this.nextPlayTime = now + 0.02;
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
    this.activeSources.push(source);
    source.onended = () => {
      const index = this.activeSources.indexOf(source);
      if (index !== -1) this.activeSources.splice(index, 1);
    };
  }

  stopPlayback(): void {
    if (this.workletPlayback && this.playbackWorklet) {
      this.playbackWorklet.port.postMessage("interrupt");
    }
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Already ended.
      }
    }
    this.activeSources = [];
    if (this.outputContext) this.nextPlayTime = this.outputContext.currentTime;
  }

  isPlaying(): boolean {
    if (this.workletPlayback && this.playbackWorklet) return true;
    return this.activeSources.length > 0;
  }

  private startVolumeMonitor(): void {
    const loop = () => {
      if (!this.recording && this.activeSources.length === 0) {
        this.onAgentVolume?.(0);
        this.monitorHandle = null;
        return;
      }
      if (this.outputAnalyser && this.onAgentVolume) {
        const data = new Uint8Array(this.outputAnalyser.frequencyBinCount);
        this.outputAnalyser.getByteFrequencyData(data);
        let sum = 0;
        for (const value of data) sum += value;
        this.onAgentVolume(sum / (data.length * 255));
      }
      this.monitorHandle = requestAnimationFrame(loop);
    };
    this.monitorHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.stopRecording();
    this.stopPlayback();
    if (this.playbackWorklet) {
      this.playbackWorklet.disconnect();
      this.playbackWorklet = null;
    }
    this.workletPlayback = false;
    if (this.outputContext) closeContext(this.outputContext);
    this.outputContext = null;
    this.outputAnalyser = null;
    this.onAgentVolume?.(0);
  }
}
