import { resolveVoiceEntryAvailability } from "@t3tools/client-runtime/voice";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { AudioLinesIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { useVoiceSession } from "./VoiceSessionProvider";

export function VoiceEntryButton({
  threadRef,
  realtimeVoiceCapability,
  onStartFromDraft,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly realtimeVoiceCapability: boolean | undefined;
  readonly onStartFromDraft?: (() => Promise<void>) | undefined;
}) {
  const { projectedHome, session, start } = useVoiceSession();
  const availability = resolveVoiceEntryAvailability({
    realtimeVoiceCapability,
    current: threadRef,
    canStartFromDraft: onStartFromDraft !== undefined,
    active: session?.home ?? projectedHome,
  });

  if (!availability.visible) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          aria-label="Start voice session"
          className="rounded-full"
          disabled={availability.disabledReason !== null}
          size="icon-sm"
          type="button"
          variant="outline"
          onClick={() => {
            if (threadRef !== null) void start(threadRef);
            else void onStartFromDraft?.();
          }}
        >
          <AudioLinesIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {availability.disabledReason ?? "Start a voice session"}
      </TooltipPopup>
    </Tooltip>
  );
}
