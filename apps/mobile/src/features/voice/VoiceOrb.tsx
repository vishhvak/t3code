import {
  VOICE_LEVEL_ATTACK_SECONDS,
  VOICE_LEVEL_RELEASE_SECONDS,
  type VoiceSessionSnapshot,
} from "@t3tools/client-runtime/voice";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Dimensions, Pressable, ScrollView, useColorScheme, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";

// Read into module constants so the frame worklet captures plain numbers
// rather than reaching through the imported module on the UI thread.
const LEVEL_ATTACK_SECONDS = VOICE_LEVEL_ATTACK_SECONDS;
const LEVEL_RELEASE_SECONDS = VOICE_LEVEL_RELEASE_SECONDS;

const ORB_SIZE = 96;
const CONTROL_SIZE = 34;
const VIEWPORT_MARGIN = 12;

// There are no theme accents to follow here the way there are on web, so the
// orb is monochrome and inverts with the color scheme: a pale pearl on dark, a
// graphite one on light, so it reads against either background.
const ORB_RAMP = {
  dark: {
    highlight: "#FFFFFF",
    mid: "#D7D7DC",
    deep: "#8B8B93",
    control: "#FFFFFF",
    controlSurface: "rgba(255,255,255,0.15)",
  },
  light: {
    highlight: "#FFFFFF",
    mid: "#71717A",
    deep: "#18181B",
    control: "#18181B",
    controlSurface: "rgba(0,0,0,0.10)",
  },
} as const;

/**
 * The orb, drawn with layered radial gradients because React Native has no
 * WebGL. Motion, not color, communicates state.
 */
export function VoiceOrb({
  session,
  closing = false,
  onClosed,
  getSignalLevel,
  onToggleMute,
  onEnd,
  onOpenHome,
}: {
  readonly session: VoiceSessionSnapshot;
  readonly closing?: boolean;
  readonly onClosed?: () => void;
  readonly getSignalLevel: () => number;
  readonly onToggleMute: () => void;
  readonly onEnd: () => void;
  readonly onOpenHome: () => void;
}) {
  const window = Dimensions.get("window");
  const ramp = ORB_RAMP[useColorScheme() === "light" ? "light" : "dark"];
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const rawLevel = useSharedValue(0);
  const level = useSharedValue(0);
  const scale = useSharedValue(0.86);
  const opacity = useSharedValue(0);
  const phase = useSharedValue(0);

  const speaking = session.phase === "speaking";
  const listening = session.phase === "listening";

  // Haptics stand in for the browser's chime: React Native has no Web Audio.
  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => undefined);
    opacity.value = withTiming(1, { duration: 260 });
    scale.value = withSpring(1, { damping: 12, stiffness: 180 });
  }, [opacity, scale]);

  useEffect(() => {
    if (!closing) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => undefined);
    opacity.value = withTiming(0, { duration: 240 });
    // The orb dissolves where it stands: no position change on the way out.
    scale.value = withTiming(0.9, { duration: 240 });
    const timeout = setTimeout(() => onClosed?.(), 260);
    return () => clearTimeout(timeout);
  }, [closing, onClosed, opacity, scale]);

  // The level reader lives on the JavaScript thread, so it is sampled into a
  // shared value; the frame loop below runs on the UI thread and only reads
  // shared values, which keeps motion smooth while JavaScript is busy.
  useEffect(() => {
    const timer = setInterval(() => {
      rawLevel.value = Math.min(1, Math.max(0, getSignalLevel()));
    }, 60);
    return () => clearInterval(timer);
  }, [getSignalLevel, rawLevel]);

  useFrameCallback((frame) => {
    const delta = Math.min(0.05, (frame.timeSincePreviousFrame ?? 16) / 1000);
    const raw = rawLevel.value;
    const seconds = raw > level.value ? LEVEL_ATTACK_SECONDS : LEVEL_RELEASE_SECONDS;
    level.value = level.value + (raw - level.value) * (1 - Math.exp(-delta / seconds));
    phase.value = (phase.value + delta * 0.22 * (1 + 1.6 * level.value)) % 1000;
  }, true);

  const breathing = useDerivedValue(() => {
    if (closing) return scale.value;
    if (speaking) return scale.value * (1 + level.value * 0.14);
    if (listening) return scale.value * (1 + level.value * 0.05);
    return scale.value * (1 + 0.012 * Math.sin(phase.value * 6));
  });

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breathing.value }],
  }));

  // Drifting the highlight is what reads as fluid without a shader.
  const highlightStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: Math.sin(phase.value * 2.1) * 6 },
      { translateY: Math.cos(phase.value * 1.7) * 5 },
      { scale: 1 + level.value * 0.12 },
    ],
    opacity: 0.75 + level.value * 0.25,
  }));

  const maxX = (window.width - ORB_SIZE) / 2 - VIEWPORT_MARGIN;
  const maxY = (window.height - ORB_SIZE) / 2 - VIEWPORT_MARGIN * 6;

  const drag = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = Math.min(maxX, Math.max(-maxX, startX.value + event.translationX));
      translateY.value = Math.min(maxY, Math.max(-maxY, startY.value + event.translationY));
    });

  const tap = Gesture.Tap().onEnd((_event, success) => {
    if (success) onOpenHome();
  });

  return (
    <View className="absolute inset-0 items-center justify-end" pointerEvents="box-none">
      <Animated.View
        className="absolute items-center"
        style={[containerStyle, { bottom: 132 }]}
        pointerEvents="box-none"
      >
        <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
          <Animated.View style={orbStyle} accessibilityLabel={`Voice orb, ${session.phase}`}>
            <Animated.View style={highlightStyle}>
              <Svg width={ORB_SIZE} height={ORB_SIZE} viewBox="0 0 100 100">
                <Defs>
                  <RadialGradient id="orbBody" cx="50%" cy="42%" r="62%">
                    <Stop offset="0%" stopColor={ramp.highlight} stopOpacity={0.95} />
                    <Stop offset="45%" stopColor={ramp.mid} stopOpacity={0.95} />
                    <Stop offset="100%" stopColor={ramp.deep} stopOpacity={1} />
                  </RadialGradient>
                  <RadialGradient id="orbSheen" cx="38%" cy="30%" r="38%">
                    <Stop offset="0%" stopColor={ramp.highlight} stopOpacity={0.9} />
                    <Stop offset="100%" stopColor={ramp.highlight} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx="50" cy="50" r="48" fill="url(#orbBody)" />
                <Circle cx="42" cy="36" r="30" fill="url(#orbSheen)" />
              </Svg>
            </Animated.View>
          </Animated.View>
        </GestureDetector>

        {session.phase === "thinking" ? (
          <Text className="mt-1 text-[11px] font-medium text-secondary-label">Thinking</Text>
        ) : null}

        <View className="mt-2 flex-row gap-2">
          <Pressable
            accessibilityLabel={session.muted ? "Unmute microphone" : "Mute microphone"}
            accessibilityRole="button"
            onPress={onToggleMute}
            className={`items-center justify-center rounded-full ${
              session.muted ? "bg-red-500/80" : ""
            }`}
            style={{
              height: CONTROL_SIZE,
              width: CONTROL_SIZE,
              ...(session.muted ? {} : { backgroundColor: ramp.controlSurface }),
            }}
          >
            <SymbolView
              name={session.muted ? "mic.slash.fill" : "mic.fill"}
              size={15}
              tintColor={session.muted ? "#FFFFFF" : ramp.control}
            />
          </Pressable>
          <Pressable
            accessibilityLabel="End voice session"
            accessibilityRole="button"
            onPress={onEnd}
            className="items-center justify-center rounded-full"
            style={{ height: CONTROL_SIZE, width: CONTROL_SIZE, backgroundColor: ramp.controlSurface }}
          >
            <SymbolView name="xmark" size={13} tintColor={ramp.control} />
          </Pressable>
        </View>

        {session.caption ? (
          <View className="mt-2 max-h-24 w-64 overflow-hidden rounded-2xl bg-black/75 px-3 py-2">
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-center text-xs leading-5 text-white">{session.caption}</Text>
            </ScrollView>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}
