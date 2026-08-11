/**
 * Envelope both orbs smooth the raw microphone/playback level with: it rises
 * quickly and falls slowly, so the orb settles with speech instead of twitching
 * at syllable rate.
 *
 * Only the constants are shared. Each renderer applies them inline because the
 * mobile orb runs its frame loop in a Reanimated worklet on the UI thread,
 * which cannot call a function imported from another package.
 */
export const VOICE_LEVEL_ATTACK_SECONDS = 0.09;
export const VOICE_LEVEL_RELEASE_SECONDS = 0.38;
