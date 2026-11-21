import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { homeShortcutsNative, type HomeShortcutItem } from '../../modules/home-shortcuts';
import { deckShortName } from './deckShortName';
import { useLastQuickAddDeck } from './quickAddDeck';

/** The type of the Home Screen quick actions that open Quick add. */
const QUICK_ADD = 'quick-add';

/**
 * The Home Screen quick actions (long-press Franki's icon): "Add words", which opens Quick add on the
 * deck last added to, and "Add to <that deck>" once there is one. A tap opens Quick add, whether it
 * woke the app or launched it: the native side keeps the tap until it's taken here
 * (modules/home-shortcuts). Called once, in the tab layout, where the router can navigate. Nothing
 * happens in a build made before the module was added.
 */
export function useHomeShortcuts(): void {
  const router = useRouter();
  const last = useLastQuickAddDeck();

  useEffect(() => {
    if (!homeShortcutsNative || last === undefined) return;
    const items: HomeShortcutItem[] = [{ type: QUICK_ADD, title: 'Add words', symbol: 'plus' }];
    if (last) items.push({ type: QUICK_ADD, title: `Add to ${deckShortName(last)}`, symbol: 'text.badge.plus', deck: last });
    homeShortcutsNative.setItems(items).catch(() => undefined);
  }, [last]);

  useEffect(() => {
    const native = homeShortcutsNative;
    if (!native) return;
    const take = () => {
      native.takePending().then((tapped) => {
        if (tapped?.type !== QUICK_ADD) return;
        router.push(tapped.deck ? { pathname: '/quick-add', params: { deck: tapped.deck } } : '/quick-add');
      }).catch(() => undefined);
    };
    // A tap that launched the app came before this could listen, so it's taken now.
    take();
    const sub = native.addListener('onShortcut', take);
    return () => sub.remove();
  }, [router]);
}
