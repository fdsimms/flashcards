import { ActionSheetIOS } from 'react-native';
import { keyOf, titleOf, type QueueItem } from '../reader/audioQueue';
import { isGlossOnly } from '../reader/languages';
import { haptic } from './haptics';
import { useAudioQueue } from './useAudioQueue';

/** Something else a list's long-press offers beside Up Next's (the shelf's Remove). */
export type MenuExtra = { label: string; destructive?: boolean; onPress: () => void };

/**
 * A text's or a lesson's long-press: Play Now (in the tab bar's player), Play Next, Play Later
 * (Up Next, useAudioQueue.ts), and whatever else that list offers, in the system's action sheet as
 * the shelf's Remove already was. Play Next and Play Later on the one playing aren't offered.
 */
export function useQueueMenu() {
  const queue = useAudioQueue();
  return (item: QueueItem, extras: MenuExtra[] = []) => {
    const playing = queue.queue.now !== null && keyOf(queue.queue.now) === keyOf(item);
    // A text in a language with no voices (Toki Pona) has nothing to play, so only the list's own actions are offered.
    const silent = item.kind === 'text' && isGlossOnly(item.language);
    const actions: MenuExtra[] = [
      ...(silent ? [] : [{ label: playing ? 'Play' : 'Play Now', onPress: () => queue.playNow(item) }]),
      ...(playing || silent ? [] : [
        { label: 'Play Next', onPress: () => queue.playNext(item) },
        { label: 'Play Later', onPress: () => queue.playLater(item) },
      ]),
      ...extras,
    ];
    if (actions.length === 0) return;
    const destructive = actions.findIndex((a) => a.destructive);
    haptic.select();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: titleOf(item),
        options: [...actions.map((a) => a.label), 'Cancel'],
        cancelButtonIndex: actions.length,
        ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
      },
      (i) => {
        const action = actions[i];
        if (!action) return;
        haptic.tap();
        action.onPress();
      },
    );
  };
}
