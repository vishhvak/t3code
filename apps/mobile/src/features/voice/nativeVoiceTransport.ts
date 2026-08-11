import type { VoiceTransport } from "@t3tools/client-runtime/voice";
import {
  MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
} from "react-native-webrtc";

const LEVEL_POLL_INTERVAL_MS = 120;
const ICE_GATHERING_TIMEOUT_MS = 4_000;
const ICE_GATHERING_POLL_INTERVAL_MS = 60;

/**
 * React Native reports loudness through connection statistics rather than an
 * audio analyser, and those reads are asynchronous, so levels are polled into
 * a cache that the synchronous transport interface can serve.
 */
interface LevelCache {
  local: number;
  remote: number;
}

function readLevels(report: unknown, cache: LevelCache): void {
  const entries = report as { forEach?: (visit: (stat: Record<string, unknown>) => void) => void };
  if (typeof entries?.forEach !== "function") return;
  entries.forEach((stat) => {
    if (stat.kind !== "audio" || typeof stat.audioLevel !== "number") return;
    if (stat.type === "media-source") {
      cache.local = Math.min(1, stat.audioLevel * 3);
    } else if (stat.type === "inbound-rtp") {
      cache.remote = Math.min(1, stat.audioLevel * 4);
    }
  });
}

/**
 * Waits for network candidate gathering so the offer carries a route back to
 * this device. State is polled rather than observed because the library's
 * shipped event typings reference a vendored shim that is absent from the
 * package. Mobile networks occasionally stall on one unreachable candidate,
 * so this gives up after a few seconds and sends what it has, which is still
 * connectable.
 */
async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  const deadline = Date.now() + ICE_GATHERING_TIMEOUT_MS;
  while (peer.iceGatheringState !== "complete" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ICE_GATHERING_POLL_INTERVAL_MS));
  }
}

/**
 * The React Native half of a voice session. Audio is carried by
 * react-native-webrtc directly between the device and the realtime service,
 * exactly as the browser carries it: it never passes through T3 Code.
 */
export function createNativeVoiceTransport(): VoiceTransport {
  const peer = new RTCPeerConnection({ iceServers: [] });
  const levels: LevelCache = { local: 0, remote: 0 };
  let localStream: MediaStream | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const startPolling = () => {
    if (pollTimer !== null) return;
    pollTimer = setInterval(() => {
      void peer
        .getStats()
        .then((report) => readLevels(report, levels))
        .catch(() => undefined);
    }, LEVEL_POLL_INTERVAL_MS);
  };

  return {
    open: async () => {
      const stream = (await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })) as MediaStream;
      localStream = stream;
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
      }
      // The realtime service expects an events data channel alongside audio.
      peer.createDataChannel("oai-events");
      const offer = await peer.createOffer({});
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("The realtime offer did not contain SDP.");
      startPolling();
      return sdp;
    },
    acceptAnswer: async (sdp) => {
      await peer.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
    },
    setMuted: (muted) => {
      for (const track of localStream?.getAudioTracks() ?? []) {
        track.enabled = !muted;
      }
    },
    localLevel: () => levels.local,
    remoteLevel: () => levels.remote,
    close: () => {
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = null;
      for (const track of localStream?.getTracks() ?? []) track.stop();
      localStream = null;
      levels.local = 0;
      levels.remote = 0;
      peer.close();
    },
  };
}
