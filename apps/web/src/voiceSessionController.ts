import type { VoiceTransport } from "@t3tools/client-runtime/voice";

export {
  VoiceSessionController,
  type VoiceSessionControllerDependencies,
  type VoiceSessionPhase,
  type VoiceSessionSnapshot,
  type VoiceTransport,
} from "@t3tools/client-runtime/voice";

interface LevelMonitor {
  readonly getLevel: () => number;
  readonly close: () => void;
}

export async function waitForIceGatheringComplete(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const onChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}

function createAnalyserMonitor(stream: MediaStream): LevelMonitor {
  const context = new AudioContext();
  void context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.72;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  return {
    getLevel: () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      return Math.min(1, Math.sqrt(sum / samples.length) * 3);
    },
    close: () => {
      source.disconnect();
      analyser.disconnect();
      void context.close();
    },
  };
}

/** The browser half of a voice session: WebRTC for carriage, Web Audio for levels. */
export function createBrowserVoiceTransport(): VoiceTransport {
  const peer = new RTCPeerConnection();
  let localStream: MediaStream | null = null;
  let localMonitor: LevelMonitor | null = null;
  let remoteMonitor: LevelMonitor | null = null;
  let remoteAudio: HTMLAudioElement | null = null;

  const onRemoteTrack = (event: RTCTrackEvent) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    const audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    audio.hidden = true;
    audio.srcObject = stream;
    document.body.append(audio);
    void audio.play().catch(() => undefined);
    remoteAudio?.remove();
    remoteAudio = audio;
    remoteMonitor?.close();
    remoteMonitor = createAnalyserMonitor(stream);
  };

  return {
    open: async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStream = stream;
      localMonitor = createAnalyserMonitor(stream);
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      peer.createDataChannel("oai-events");
      peer.addEventListener("track", onRemoteTrack);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      // The offer must carry gathered candidates, otherwise the agent has no
      // route back to this browser.
      await waitForIceGatheringComplete(peer);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("The realtime offer did not contain SDP.");
      return sdp;
    },
    acceptAnswer: async (sdp) => {
      await peer.setRemoteDescription({ type: "answer", sdp });
    },
    setMuted: (muted) => {
      for (const track of localStream?.getAudioTracks() ?? []) track.enabled = !muted;
    },
    localLevel: () => localMonitor?.getLevel() ?? 0,
    remoteLevel: () => remoteMonitor?.getLevel() ?? 0,
    close: () => {
      peer.removeEventListener("track", onRemoteTrack);
      peer.close();
      for (const track of localStream?.getTracks() ?? []) track.stop();
      localStream = null;
      localMonitor?.close();
      localMonitor = null;
      remoteMonitor?.close();
      remoteMonitor = null;
      remoteAudio?.pause();
      if (remoteAudio) remoteAudio.srcObject = null;
      remoteAudio?.remove();
      remoteAudio = null;
    },
  };
}
