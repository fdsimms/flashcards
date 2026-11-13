import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import type { DeckRow } from '../core/deckTree';
import { parseReminder, reminderPlan, type ReminderPrefs } from '../core/reminder';

/**
 * The study reminder's phone side (src/core/reminder.ts has the rules): the setting, kept in the
 * Keychain like the other settings that are this phone's own, and the notifications handed to
 * iOS. `useStudyReminder` rewrites them each time the deck list is recounted, so tonight's
 * reminder carries tonight's counts.
 */

const KEY = 'reminder.prefs';
/** Every reminder Franki schedules starts with this, so a rewrite removes only its own. */
const ID_PREFIX = 'study-reminder-';

let current: ReminderPrefs | undefined;
const listeners = new Set<(prefs: ReminderPrefs) => void>();

export async function loadReminder(): Promise<ReminderPrefs> {
  current ??= parseReminder(await SecureStore.getItemAsync(KEY).catch(() => null));
  return current;
}

/** Saves the setting (throwing when the Keychain won't take it), then reschedules for it. */
export async function saveReminder(prefs: ReminderPrefs): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(prefs));
  current = prefs;
  for (const l of listeners) l(prefs);
}

/** Whether iOS lets Franki show notifications; asks the first time, when `ask` is set. */
export async function notificationsAllowed(ask: boolean): Promise<boolean> {
  const allowed = (s: Notifications.NotificationPermissionsStatus) =>
    s.granted || s.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  const now = await Notifications.getPermissionsAsync();
  if (allowed(now) || !ask || !now.canAskAgain) return allowed(now);
  return allowed(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
}

// One rewrite at a time, in the order asked: two recounts close together mustn't interleave
// their cancels and adds and leave both sets scheduled.
let queue: Promise<void> = Promise.resolve();

function reschedule(prefs: ReminderPrefs, rows: DeckRow[], dayStartsAtHour: number): Promise<void> {
  queue = queue.then(async () => {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(pending
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    const plan = reminderPlan({ prefs, rows, now: new Date(), dayStartsAtHour });
    for (const [i, r] of plan.entries()) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${i}`,
        content: { title: r.title, body: r.body, sound: 'default' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
  }).catch(() => {
    // A reminder that couldn't be written is tried again at the next recount.
  });
  return queue;
}

/** The setting as it is now, following every save; undefined until it's been read. */
export function useReminderPrefs(): ReminderPrefs | undefined {
  const [prefs, setPrefs] = useState<ReminderPrefs | undefined>(current);
  useEffect(() => {
    let live = true;
    loadReminder().then((p) => { if (live) setPrefs(p); });
    listeners.add(setPrefs);
    return () => { live = false; listeners.delete(setPrefs); };
  }, []);
  return prefs;
}

/** The reminder's time as the phone writes times, "8:00 PM". */
export function reminderTime(prefs: Pick<ReminderPrefs, 'hour' | 'minute'>): string {
  return new Date(2000, 0, 1, prefs.hour, prefs.minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Keeps the scheduled reminders in step with the deck list's counts and the setting. */
export function useStudyReminder(decks: DeckRow[], dayStartsAtHour: number): void {
  const prefs = useReminderPrefs();
  useEffect(() => {
    // Before the setting is read, or the deck list's first count, there's nothing to write; turned off, the rewrite clears them.
    if (!prefs || (prefs.on && decks.length === 0)) return;
    reschedule(prefs, decks, dayStartsAtHour);
  }, [prefs, decks, dayStartsAtHour]);
}
