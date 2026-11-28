import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { shareToOpen, type SharedItem } from '../core/shareInbox';
import { useApp } from './AppContext';
import { shareInbox } from './shareInbox';

/** The screen a share opens: Your own text to read it, Add a video for a video's link, Look up for its words' meanings, or Quick add for its words. */
export function openShare(router: ReturnType<typeof useRouter>, item: SharedItem): void {
  if (item.kind === 'video') router.push({ pathname: '/read-write', params: { kind: 'video', shared: item.id } });
  else if (item.kind === 'read') router.push({ pathname: '/read-write', params: { kind: 'own', shared: item.id } });
  else if (item.kind === 'lookup') router.push({ pathname: '/look-up', params: { shared: item.id } });
  else router.push({ pathname: '/quick-add', params: { shared: item.id } });
}

/**
 * Text shared to Franki from another app (the share extension, targets/share/). On launch and each
 * return to the foreground, takes what the extension left (shareInbox) and opens the newest share
 * made within the hour on its screen (`shareToOpen`), once per run of the app. An older one, or a
 * text to read while Read & Listen is off, waits on Today's banner (SharedBanner). Called once, in
 * the tab layout, where the router can navigate, as useHomeShortcuts is.
 */
export function useShareInbox(): void {
  const router = useRouter();
  const { reader } = useApp();
  const canRead = !!reader.api;
  const opened = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    const take = () => {
      shareInbox.take().then((items) => {
        if (!live) return;
        const next = shareToOpen(items, opened.current, canRead, Date.now());
        if (!next) return;
        opened.current.add(next.id);
        openShare(router, next);
      }).catch(() => undefined);
    };
    take();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') take(); });
    return () => { live = false; sub.remove(); };
  }, [router, canRead]);
}
