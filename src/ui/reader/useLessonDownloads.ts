import type { SFSymbol } from 'expo-symbols';
import { Alert } from 'react-native';
import type { Api, AudioLesson } from '../../reader/api';
import { asksBeforeLesson, megabytes } from '../../reader/downloads';
import { prefs } from '../../reader/storage';
import { failureText } from '../../core/failure';
import { connection } from '../connection';
import { haptic } from '../haptics';
import { downloads, useDownloads, useSaving } from './readerDownloads';

// At 48 kbit/s, Azure's lesson MP3 runs about 6 KB a second.
const BYTES_PER_MS = 6;

/**
 * A ready lesson's round button on Audio lessons, as iOS shows a download: an outlined arrow to
 * download it (asking first on cellular, unless Settings says any connection), a dotted one while it
 * saves, and a filled one once it's on this iPhone, which asks before removing it.
 */
export function useLessonDownloads(api: Api) {
  const kept = useDownloads();
  const saving = useSaving().lessons;

  const save = async (lesson: AudioLesson) => {
    try {
      await downloads.saveLesson(api, lesson);
      haptic.success();
    } catch (e) {
      Alert.alert(`Couldn't download ${lesson.title}`, failureText(e, { next: "Check your connection, then try again." }));
    }
  };

  const download = (lesson: AudioLesson) => {
    if (!asksBeforeLesson(prefs().offlineDownloads, connection.get().path)) { void save(lesson); return; }
    const size = megabytes(lesson.duration_ms * BYTES_PER_MS);
    Alert.alert("You're on cellular", `Downloading ${lesson.title} uses about ${size} of cellular data.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Download', onPress: () => { void save(lesson); } },
    ]);
  };

  const remove = (lesson: AudioLesson) => {
    Alert.alert(`Remove ${lesson.title} from this iPhone?`, "You can download it again while you're online.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => downloads.dropLessons([lesson.id]) },
    ]);
  };

  return (lesson: AudioLesson): { icon: SFSymbol; label: string; onPress: () => void } => {
    if (saving.has(lesson.id)) return { icon: 'arrow.down.circle.dotted', label: `Downloading ${lesson.title}`, onPress: () => undefined };
    if (kept.lessons.some((l) => l.lesson.id === lesson.id && l.complete)) {
      return { icon: 'arrow.down.circle.fill', label: `${lesson.title} is on this iPhone. Remove it`, onPress: () => remove(lesson) };
    }
    return { icon: 'arrow.down.circle', label: `Download ${lesson.title}`, onPress: () => download(lesson) };
  };
}
