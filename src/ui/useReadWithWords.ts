import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useCallback, useRef } from 'react';
import { ApiError, type Language } from '../reader/api';
import { useApp } from './AppContext';

/**
 * "Read a text with these words" (Review's end-of-session step, a cram's Read a text): writes a text
 * on `topicName` when the caller has one (a cram's is what it is for), else on the idea that best
 * fits the language's deck, and opens the reader on it, which shows the text being written and
 * plays it when it lands. Nothing stops on the shelf in between.
 *
 * Synced first, so the server reads the answers just given before it writes the text. The reader
 * is pushed, not replaced, so Back returns to where this was started from. `stillHere` is asked
 * after each wait: false when the screen was left meanwhile, so the push doesn't land on whatever is
 * in front. A failure is an alert, since the button that started this is the only thing on screen.
 */
export function useReadWithWords() {
  const router = useRouter();
  const { reader, sync } = useApp();
  const { api, settings, setSettings } = reader;
  // A second tap while the first is still writing would start a second text.
  const running = useRef(false);
  return useCallback(async (language: Language, words: string[], stillHere: () => boolean = () => true, topicName?: string) => {
    if (!api || running.current) return;
    running.current = true;
    try {
      await sync({ afterRunning: true });
      if (!stillHere()) return;
      // The ideas it suggests are for the language the server is set to.
      if (settings?.language !== language) {
        await api.updateSettings({ language });
        api.settings().then(setSettings, () => undefined);
        if (!stillHere()) return;
      }
      let name = topicName;
      if (!name) {
        const [idea] = await api.suggestions();
        if (!idea) throw new ApiError('There are no topic ideas left. Tap + in Read & Listen to write a text on a topic of your own instead.', 0);
        name = idea.name;
      }
      const topic = await api.addTopic(name);
      if (!stillHere()) return;
      router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'topic', topic, words }) } });
    } catch (e) {
      Alert.alert("Couldn't start that text", e instanceof ApiError ? e.message : 'Check your connection and try again.');
    } finally {
      running.current = false;
    }
  }, [api, settings?.language, setSettings, sync, router]);
}
