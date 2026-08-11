import { resolveVoiceEntryAvailability } from "@t3tools/client-runtime/voice";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { ComposerToolbarButton } from "../../components/ComposerToolbarTrigger";
import { useEnvironmentServerConfig } from "../../state/entities";

import { useVoiceSession } from "./VoiceSessionProvider";

export function VoiceEntryButton({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  const { projectedHome, session, start } = useVoiceSession();
  const serverConfig = useEnvironmentServerConfig(threadRef?.environmentId ?? null);
  const availability = resolveVoiceEntryAvailability({
    realtimeVoiceCapability: serverConfig?.environment.capabilities.realtimeVoice,
    current: threadRef,
    active: session?.home ?? projectedHome,
  });

  if (!availability.visible || threadRef === null) return null;

  return (
    <ComposerToolbarButton
      accessibilityLabel="Start voice session"
      icon="waveform"
      disabled={availability.disabledReason !== null}
      onPress={() => void start(threadRef)}
      showChevron={false}
    />
  );
}
