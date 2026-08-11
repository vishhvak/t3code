import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { useEffect } from "react";

import { clearVoiceHomeRequest, voiceHomeRequestAtom } from "./voiceState";

/**
 * Consumes the orb's open-home request inside the navigation tree
 * (RootStackLayout) and opens the session's thread. Lives apart from
 * voiceState.ts so the orb and its provider do not pull @react-navigation into
 * their module graph.
 */
export function useVoiceHomeNavigation(): void {
  const navigation = useNavigation();
  const home = useAtomValue(voiceHomeRequestAtom);

  useEffect(() => {
    if (home === null) return;
    // This app registers no global navigation parameter list, so the shared
    // navigation object types its route names as `never`. Narrowing to the one
    // route this hook uses keeps the call honest without depending on a
    // repository-wide navigation typing change.
    const navigate = navigation.navigate as unknown as (
      name: "Thread",
      params: { environmentId: string; threadId: string },
    ) => void;
    // Cleared on the way through so tapping the orb again re-navigates.
    clearVoiceHomeRequest();
    navigate("Thread", { environmentId: home.environmentId, threadId: home.threadId });
  }, [home, navigation]);
}
