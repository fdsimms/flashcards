import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { DAY_STARTS_AT_HOUR } from '../core/config';
import { studyDayKey } from '../core/day';
import { parseVacation, type VacationPrefs } from '../core/vacation';
import { useApp } from './AppContext';

/**
 * Vacation mode's phone side (src/core/vacation.ts has the rules): the setting, kept in the
 * Keychain like the other settings that are this phone's own, so it stays out of a backup and
 * never reaches Anki. The deck list and the review screen read it into `queueInput`.
 */

const KEY = 'vacation.prefs';

let current: VacationPrefs | undefined;
const listeners = new Set<(prefs: VacationPrefs) => void>();

export async function loadVacation(): Promise<VacationPrefs> {
  current ??= parseVacation(await SecureStore.getItemAsync(KEY).catch(() => null));
  return current;
}

/** Saves the setting (throwing when the Keychain won't take it), then tells everything showing it. */
export async function saveVacation(prefs: VacationPrefs): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(prefs));
  current = prefs;
  for (const l of listeners) l(prefs);
}

/** The setting as it is now, following every save; undefined until it's been read. */
export function useVacationPrefs(): VacationPrefs | undefined {
  const [prefs, setPrefs] = useState<VacationPrefs | undefined>(current);
  useEffect(() => {
    let live = true;
    loadVacation().then((p) => { if (live) setPrefs(p); });
    listeners.add(setPrefs);
    return () => { live = false; listeners.delete(setPrefs); };
  }, []);
  return prefs;
}

/** Counts the deck list again whenever the setting is saved (AppContext calls this in one line). */
export function useVacationRefresh(refresh: () => Promise<void>): void {
  useEffect(() => {
    const l = () => { refresh(); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [refresh]);
}

/** The study day today falls in, by the collection's "Next day starts at", and that hour. */
export function useStudyToday(): { today: string; dayStartsAtHour: number } {
  const { repo } = useApp();
  const [hour, setHour] = useState(DAY_STARTS_AT_HOUR);
  useEffect(() => {
    let live = true;
    repo.collectionSettings().then((s) => { if (live) setHour(s.dayStartsAtHour); }).catch(() => undefined);
    return () => { live = false; };
  }, [repo]);
  return { today: studyDayKey(new Date(), hour), dayStartsAtHour: hour };
}

