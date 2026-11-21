import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import type { DeckRow } from '../core/deckTree';
import { backupReminderPlan, oldestAdded } from '../db/backup';
import { noteAddedAt } from '../core/cram';
import type { AppRepo } from './AppContext';

/**
 * The backup reminder's phone side (src/db/backup.ts, `backupReminderPlan`, has the rules): the
 * on/off setting, kept in the Keychain like the study reminder's, and the notifications handed to
 * iOS. Off until turned on (Backup). Nothing leaves the phone.
 */

const KEY = 'backupReminder.on';
/** Every backup reminder starts with this, so a rewrite removes only its own and never the study reminder's. */
const ID_PREFIX = 'backup-reminder-';
const ROUTE = '/backup';

let current: boolean | undefined;
const listeners = new Set<(on: boolean) => void>();

async function load(): Promise<boolean> {
  current ??= (await SecureStore.getItemAsync(KEY).catch(() => null)) === 'true';
  return current;
}

/** Saves the setting, throwing when the Keychain won't take it. */
export async function saveBackupReminder(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY, String(on));
  current = on;
  for (const l of listeners) l(on);
}

/** Whether the reminder is on, following every save; undefined until it's been read. */
export function useBackupReminderOn(): boolean | undefined {
  const [on, setOn] = useState<boolean | undefined>(current);
  useEffect(() => {
    let live = true;
    load().then((v) => { if (live) setOn(v); });
    listeners.add(setOn);
    return () => { live = false; listeners.delete(setOn); };
  }, []);
  return on;
}

// One rewrite at a time, in the order asked, and the last backup is read inside it: two recounts
// close together mustn't interleave their cancels and adds, or write from a time that's gone stale.
let queue: Promise<void> = Promise.resolve();

function reschedule(repo: AppRepo, on: boolean, hasCards: boolean, dayStartsAtHour: number): Promise<void> {
  queue = queue.then(async () => {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(pending
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    if (!on) return;
    const firstAddedAt = hasCards ? oldestAdded((await repo.listNotes()).map(noteAddedAt)) : null;
    const plan = backupReminderPlan({ lastBackupAt: await repo.lastBackupAt(), firstAddedAt, now: new Date(), dayStartsAtHour });
    for (const [i, r] of plan.entries()) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${i}`,
        content: { title: r.title, body: r.body, sound: 'default', data: { route: ROUTE } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
  }).catch(() => {
    // A reminder that couldn't be written is tried again at the next recount.
  });
  return queue;
}

/**
 * Keeps the scheduled backup reminders in step with the setting and the last backup, rewritten
 * each time the deck list is recounted (the Backup screen asks for one after a backup), and opens
 * Backup when a reminder is tapped, including the tap that launched the app.
 */
export function useBackupReminder(repo: AppRepo | undefined, decks: DeckRow[], dayStartsAtHour: number): void {
  const on = useBackupReminderOn();
  const router = useRouter();
  useEffect(() => {
    if (!repo || on === undefined) return;
    reschedule(repo, on, decks.length > 0, dayStartsAtHour);
  }, [repo, on, decks, dayStartsAtHour]);

  const tap = Notifications.useLastNotificationResponse();
  const opened = useRef<string>(undefined);
  useEffect(() => {
    if (!repo || !tap || tap.notification.request.content.data?.route !== ROUTE) return;
    // The same response is still "last" on every later render: open Backup once for it.
    const id = `${tap.notification.request.identifier}@${tap.notification.date}`;
    if (opened.current === id) return;
    opened.current = id;
    router.push(ROUTE);
  }, [repo, tap]); // eslint-disable-line react-hooks/exhaustive-deps
}
