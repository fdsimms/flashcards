import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { nextStudyDayStart, studyDayKey } from '../core/day';

/**
 * Today's study-day key (src/core/day.ts), which changes when the next study day starts, whether
 * the screen is open then or the app comes back to the front after it. A screen left open across
 * the day start reads it to work out its day again: nothing else it holds would change.
 */
export function useStudyDay(dayStartsAtHour: number): string {
  const [key, setKey] = useState(() => studyDayKey(new Date(), dayStartsAtHour));
  useEffect(() => {
    const check = () => setKey(studyDayKey(new Date(), dayStartsAtHour));
    check();
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const now = new Date();
      // A second past the start, so the key read then is the new day's.
      timer = setTimeout(() => { check(); arm(); }, nextStudyDayStart(now, dayStartsAtHour).getTime() - now.getTime() + 1000);
    };
    arm();
    // A timer doesn't run while the app is in the background.
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { clearTimeout(timer); sub.remove(); };
  }, [dayStartsAtHour]);
  return key;
}
