import {
  VOICE_LEVEL_ATTACK_SECONDS,
  VOICE_LEVEL_RELEASE_SECONDS,
} from "@t3tools/client-runtime/voice";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import type { VoiceOrbColors } from "~/voiceOrbColor";
import type { VoiceSessionPhase, VoiceSessionSnapshot } from "~/voiceSessionController";

import { FluidOrb } from "./FluidOrb";

const ORB_SIZE = 96;
const VIEWPORT_MARGIN = 8;

function MicGlyph({ muted }: { readonly muted: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {muted ? (
        <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

const SPRING: Record<VoiceSessionPhase, { stiffness: number; damping: number }> = {
  idle: { stiffness: 60, damping: 14 },
  listening: { stiffness: 80, damping: 18 },
  thinking: { stiffness: 60, damping: 14 },
  speaking: { stiffness: 200, damping: 12 },
};

/**
 * Arrival and departure chimes, synthesized rather than loaded from assets.
 * Optional: a blocked or absent AudioContext must not break the session.
 */
function playBoop(direction: "in" | "out") {
  try {
    const context = new AudioContext();
    const now = context.currentTime;
    const rising = direction === "in";
    const total = rising ? 1.5 : 1.55;
    const glideSeconds = 0.14;

    // Short percussive onset under the chime.
    const pop = context.createOscillator();
    pop.type = "sine";
    pop.frequency.setValueAtTime(rising ? 760 : 420, now);
    pop.frequency.exponentialRampToValueAtTime(rising ? 220 : 110, now + 0.085);
    const popGain = context.createGain();
    popGain.gain.setValueAtTime(0.0001, now);
    popGain.gain.exponentialRampToValueAtTime(rising ? 0.08 : 0.05, now + 0.004);
    popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    pop.connect(popGain).connect(context.destination);
    pop.start(now);
    pop.stop(now + 0.15);

    const master = context.createGain();
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(3200, now);
    lowpass.Q.setValueAtTime(0.5, now);
    // Full strength through the first third of a second, then a long ring-out.
    const peak = rising ? 0.3 : 0.24;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(peak, now + 0.05);
    master.gain.setValueAtTime(peak, now + 0.32);
    master.gain.exponentialRampToValueAtTime(peak * 0.12, now + 0.75);
    master.gain.exponentialRampToValueAtTime(0.0001, now + total);
    master.connect(lowpass).connect(context.destination);

    // [glide-from, landing, weight] per chime note; octave partials add air.
    const notes: Array<[number, number, number]> = rising
      ? [
          [233.1, 277.2, 1],
          [233.1, 329.6, 0.8],
          [466.2, 554.4, 0.3],
          [466.2, 659.3, 0.22],
        ]
      : [
          [277.2, 220, 1],
          [277.2, 440, 0.55],
          [554.4, 880, 0.14],
        ];
    let primary = true;
    for (const [from, to, weight] of notes) {
      // Two oscillators a few cents apart per note: the detuned unison is
      // what keeps this from sounding like a bare test tone.
      for (const detune of [-3, 3]) {
        const osc = context.createOscillator();
        osc.type = "sine";
        osc.detune.setValueAtTime(detune, now);
        osc.frequency.setValueAtTime(from, now);
        osc.frequency.exponentialRampToValueAtTime(to, now + glideSeconds);
        const gain = context.createGain();
        gain.gain.setValueAtTime(weight / 2, now);
        osc.connect(gain).connect(master);
        osc.start(now);
        osc.stop(now + total);
        if (primary) {
          osc.addEventListener("ended", () => void context.close().catch(() => undefined), {
            once: true,
          });
          primary = false;
        }
      }
    }
  } catch {
    // Intentionally silent.
  }
}

export function VoiceOrbWidget({
  session,
  colors,
  closing = false,
  onClosed,
  getSignalLevel,
  onToggleMute,
  onEnd,
  onNavigateHome,
}: {
  readonly session: VoiceSessionSnapshot;
  readonly colors: VoiceOrbColors;
  readonly closing?: boolean;
  readonly onClosed?: () => void;
  readonly getSignalLevel: () => number;
  readonly onToggleMute: () => void;
  readonly onEnd: () => void;
  readonly onNavigateHome: () => void;
}) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<{ x: number; y: number } | null>(null);
  const phaseRef = useRef(session.phase);
  const scaleRef = useRef({ value: 1, velocity: 0 });
  const smoothedLevelRef = useRef(0);

  useEffect(() => {
    phaseRef.current = session.phase;
  }, [session.phase]);

  // Spawn centered above the composer, not at a fixed viewport offset: the
  // composer sits at the bottom of a thread view but mid-screen on the home
  // draft, and it is horizontally offset by the sidebar in both.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const composer = document.querySelector(".chat-composer-glass-shell");
    if (root && composer) {
      const rect = composer.getBoundingClientRect();
      root.style.left = `${rect.left + rect.width / 2}px`;
      if (rect.top < window.innerHeight * 0.55) {
        // Mid-screen composer means the draft hero layout, where the
        // headline occupies the space above; spawn below into open space.
        root.style.top = `${rect.bottom + 12}px`;
        root.style.bottom = "auto";
      } else {
        root.style.bottom = `${Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.top + 12)}px`;
        root.style.top = "auto";
      }
    }
  }, []);

  useEffect(() => {
    playBoop("in");
    if (reducedMotion) return;
    contentRef.current?.animate(
      [
        { opacity: 0, filter: "blur(14px)", transform: "scale(0.86) translateY(12px)" },
        {
          opacity: 1,
          filter: "blur(0px)",
          transform: "scale(1.03) translateY(-2px)",
          offset: 0.72,
        },
        { opacity: 1, filter: "blur(0px)", transform: "scale(1) translateY(0)" },
      ],
      { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [reducedMotion]);

  // Dissolve out the same way the widget dissolved in, then let the
  // provider unmount it.
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  useEffect(() => {
    if (!closing) return;
    playBoop("out");
    const content = contentRef.current;
    // Position is untouched on the way out: the same snapshot renders
    // throughout, so nothing reflows and only the inner content animates.
    if (!content || reducedMotion) {
      onClosedRef.current?.();
      return;
    }
    const animation = content.animate(
      [
        { opacity: 1, filter: "blur(0px)", transform: "scale(1)" },
        { opacity: 0, filter: "blur(14px)", transform: "scale(0.92)" },
      ],
      { duration: 340, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
    );
    animation.onfinish = () => onClosedRef.current?.();
    return () => animation.cancel();
  }, [closing, reducedMotion]);

  const clampToViewport = useCallback(() => {
    const root = rootRef.current;
    const position = positionRef.current;
    if (!root || !position) return;
    const rect = root.getBoundingClientRect();
    position.x = Math.min(
      window.innerWidth - rect.width - VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, position.x),
    );
    position.y = Math.min(
      window.innerHeight - rect.height - VIEWPORT_MARGIN,
      Math.max(VIEWPORT_MARGIN, position.y),
    );
    root.style.left = `${position.x}px`;
    root.style.top = `${position.y}px`;
  }, []);

  // The caption growing or collapsing changes the widget's height; once the
  // widget has been dragged (top-anchored), that growth can push it past the
  // bottom edge unless it is re-clamped.
  useEffect(() => {
    window.addEventListener("resize", clampToViewport);
    const observer = new ResizeObserver(clampToViewport);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => {
      window.removeEventListener("resize", clampToViewport);
      observer.disconnect();
    };
  }, [clampToViewport]);

  // Keep the caption pinned to the newest words as they stream in.
  useEffect(() => {
    const caption = captionRef.current;
    if (caption) caption.scrollTop = caption.scrollHeight;
  }, [session.caption]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    root.setPointerCapture?.(event.pointerId);
    let lastX = event.clientX;
    let lastY = event.clientY;
    let dragged = false;
    const rect = root.getBoundingClientRect();
    positionRef.current ??= { x: rect.left, y: rect.top };
    // Both properties: Tailwind v4's centering lives in `translate`.
    root.style.transform = "none";
    root.style.translate = "none";
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";

    const move = (moveEvent: PointerEvent) => {
      const position = positionRef.current;
      if (!position) return;
      const deltaX = moveEvent.clientX - lastX;
      const deltaY = moveEvent.clientY - lastY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 2) dragged = true;
      position.x += deltaX;
      position.y += deltaY;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      root.style.right = "auto";
      root.style.bottom = "auto";
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragged) onNavigateHome();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  useEffect(() => {
    if (reducedMotion) {
      orbRef.current?.style.setProperty("transform", "none");
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (document.hidden) {
        last = now;
        frame = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const phase = phaseRef.current;
      const raw = Math.min(1, Math.max(0, getSignalLevel()));
      const envelope = smoothedLevelRef.current;
      const seconds = raw > envelope ? VOICE_LEVEL_ATTACK_SECONDS : VOICE_LEVEL_RELEASE_SECONDS;
      smoothedLevelRef.current = envelope + (raw - envelope) * (1 - Math.exp(-dt / seconds));
      const level = smoothedLevelRef.current;
      let target = 1;
      if (phase === "speaking") target = 1 + level * 0.14;
      else if (phase === "listening") target = 1 + level * 0.05;
      else if (phase === "thinking") target = 1 + 0.025 * Math.sin(now / 420);
      else target = 1 + 0.012 * Math.sin(now / 900);
      const { stiffness, damping } = SPRING[phase];
      const spring = scaleRef.current;
      const acceleration = stiffness * (target - spring.value) - damping * spring.velocity;
      spring.velocity += acceleration * dt;
      spring.value += spring.velocity * dt;
      orbRef.current?.style.setProperty("transform", `scale(${spring.value.toFixed(4)})`);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getSignalLevel, reducedMotion]);

  const smoothedLevel = useCallback(() => smoothedLevelRef.current, []);

  return (
    <div
      ref={rootRef}
      className="fixed bottom-[92px] left-1/2 z-[80] -translate-x-1/2 touch-none select-none cursor-grab active:cursor-grabbing max-[540px]:bottom-[84px]"
      role="group"
      aria-label={`Voice orb, ${session.phase}${session.muted ? ", microphone muted" : ""}`}
      onPointerDown={onPointerDown}
    >
      <div ref={contentRef} className="relative flex flex-col items-center gap-2">
        <div
          ref={orbRef}
          className="relative size-24 rounded-full drop-shadow-[0_10px_28px_rgba(0,0,0,0.35)] will-change-transform"
          title={`Voice: ${session.phase}`}
        >
          <FluidOrb
            size={ORB_SIZE}
            color={colors.primary}
            colorSecondary={colors.secondary}
            getLevel={reducedMotion ? getSignalLevel : smoothedLevel}
            tempo={session.phase === "thinking" ? 0.45 : 1}
          />
        </div>

        {session.phase === "thinking" ? (
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-muted-foreground">
            Thinking
          </span>
        ) : null}

        <div className="flex flex-row gap-1.5">
          <button
            type="button"
            className={`grid size-[30px] place-items-center rounded-full border border-white/15 bg-white/10 text-slate-200 outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-slate-200${session.muted ? " bg-red-500/75 text-white" : ""}`}
            aria-label={session.muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={session.muted}
            onClick={onToggleMute}
          >
            <MicGlyph muted={session.muted} />
          </button>
          <button
            type="button"
            className="grid size-[30px] place-items-center rounded-full border border-white/15 bg-white/10 text-slate-200 outline-none hover:bg-red-500/40 focus-visible:ring-2 focus-visible:ring-slate-200"
            aria-label="End voice session"
            onClick={onEnd}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 5l14 14M19 5L5 19"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {session.caption ? (
          <div className="pointer-events-none w-64 overflow-hidden rounded-lg border border-white/10 bg-black/70 shadow-lg backdrop-blur-sm">
            <div
              ref={captionRef}
              className="max-h-[6.5rem] overflow-y-auto px-3 py-1.5 text-center text-xs leading-relaxed text-white [scrollbar-width:none] [mask-image:linear-gradient(to_bottom,transparent_0,black_1.5rem)] [&::-webkit-scrollbar]:hidden"
              aria-live="polite"
            >
              {session.caption}
            </div>
          </div>
        ) : null}
        <span className="sr-only" aria-live="polite">
          {session.phase}
        </span>
      </div>
    </div>
  );
}
