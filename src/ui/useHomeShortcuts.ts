import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { homeShortcutsNative, type HomeShortcutItem } from '../../modules/home-shortcuts';
import { deckShortName } from './deckShortName';
import { lastQuickAddDeck, lastStudiedDeck } from './lastDeck';

/** The types of the Home Screen quick actions: Quick add, and studying a deck. */
const QUICK_ADD = 'quick-add';
const STUDY = 'study';

/**
 * The Home Screen quick actions (long-press Franki's icon): "Add words", which opens Quick add on the
 * deck last added to, "Add to <that deck>" once there is one, and "Study <the deck last studied>". A
 * tap opens Quick add or Review, whether it
 * woke the app or launched it: the native side keeps the tap until it's taken here
 * (modules/home-shortcuts). Called once, in the tab layout, where the router can navigate. Nothing
 * happens in a build made before the module was added.
 */
export function useHomeShortcuts(): void {
  const router = useRouter();
  const added = lastQuickAddDeck.use();
  const studied = lastStudiedDeck.use();

  useEffect(() => {
    if (!homeShortcutsNative || added === undefined || studied === undefined) return;
    const items: HomeShortcutItem[] = [{ type: QUICK_ADD, title: 'Add words', symbol: 'plus' }];
    if (added) items.push({ type: QUICK_ADD, title: `Add to ${deckShortName(added)}`, symbol: 'text.badge.plus', deck: added });
    if (studied) items.push({ type: STUDY, title: `Study ${deckShortName(studied)}`, symbol: 'rectangle.stack', deck: studied });
    homeShortcutsNative.setItems(items).catch(() => undefined);
  }, [added, studied]);

  useEffect(() => {
    const native = homeShortcutsNative;
    if (!native) return;
    const take = () => {
      native.takePending().then((tapped) => {
        if (tapped?.type === STUDY && tapped.deck) router.push({ pathname: '/review', params: { deck: tapped.deck } });
        if (tapped?.type === QUICK_ADD) router.push(tapped.deck ? { pathname: '/quick-add', params: { deck: tapped.deck } } : '/quick-add');
      }).catch(() => undefined);
    };
    // A tap that launched the app came before this could listen, so it's taken now.
    take();
    const sub = native.addListener('onShortcut', take);
    return () => sub.remove();
  }, [router]);
}
