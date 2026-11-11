import * as Haptics from 'expo-haptics';

/**
 * The taps the app gives back, so a press feels like it landed. iOS applies the system's own
 * Haptics setting, so these do nothing for someone who turned it off. A failed haptic is never
 * worth an error: every call swallows it.
 */
const quiet = (p: Promise<void>) => { p.catch(() => undefined); };

export const haptic = {
  /** A choice moved: a chip, a checkmark, a switch. */
  select: () => quiet(Haptics.selectionAsync()),
  /** A button pressed. */
  tap: () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A card answered: a touch firmer than a button, since it's what the whole app is for. */
  answer: () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Something finished well: a deck cleared. */
  success: () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
