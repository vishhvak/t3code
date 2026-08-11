import { useCallback, useSyncExternalStore } from "react";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "./hooks/useLocalStorage";

/** Used when a theme exposes no usable accent, which custom themes may not. */
export const FALLBACK_VOICE_ORB_COLOR = "#7B8CFF";
const VOICE_ORB_COLOR_KEY = "t3code:voice-orb-color:v1";

// The same two roles the theme preview balls pair in settings, so the orb reads
// as the same object those balls are previewing.
const ACCENT_VARIABLE = "--app-theme-accent";
const ACTION_VARIABLE = "--app-theme-message-action";

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

function readThemeColor(variable: string): string | null {
  if (typeof document === "undefined") return null;
  return normalizeHexColor(
    getComputedStyle(document.documentElement).getPropertyValue(variable),
  );
}

// Themes are applied by writing custom properties and the dark class onto the
// root element, so watching its attributes covers every way the theme changes,
// including live preview while browsing the theme list.
function subscribeToThemeColors(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["style", "class", "data-theme-id"],
  });
  return () => observer.disconnect();
}

function useThemeColor(variable: string, fallback: string): string {
  const getSnapshot = useCallback(
    () => readThemeColor(variable) ?? fallback,
    [fallback, variable],
  );
  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  return useSyncExternalStore(subscribeToThemeColors, getSnapshot, getServerSnapshot);
}

export interface VoiceOrbColors {
  readonly primary: string;
  readonly secondary: string;
}

/**
 * The colors the orb renders with. It follows the active theme unless the user
 * has picked an explicit color, in which case that color carries the whole orb.
 */
export function useVoiceOrbColors(): VoiceOrbColors {
  const [override] = useVoiceOrbColorOverride();
  const accent = useThemeColor(ACCENT_VARIABLE, FALLBACK_VOICE_ORB_COLOR);
  const action = useThemeColor(ACTION_VARIABLE, accent);
  const chosen = normalizeHexColor(override);
  if (chosen !== null) return { primary: chosen, secondary: chosen };
  return { primary: accent, secondary: action };
}

/** The explicit color, or an empty string while the orb follows the theme. */
export function useVoiceOrbColorOverride(): readonly [string, (value: string) => void] {
  const [stored, setStored] = useLocalStorage(VOICE_ORB_COLOR_KEY, "", Schema.String);
  const override = normalizeHexColor(stored) ?? "";
  const setOverride = useCallback(
    (value: string) => setStored(normalizeHexColor(value) ?? ""),
    [setStored],
  );
  return [override, setOverride] as const;
}
