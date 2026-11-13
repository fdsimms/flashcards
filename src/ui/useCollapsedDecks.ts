import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { collapsedDecks, setDeckCollapsed, type NoteStore } from '../anki/noteService';
import { failureText } from '../core/failure';

export interface CollapsedDecks {
  /** Decks whose subdecks the deck list hides: Anki's own collapsed state, shared through sync. */
  collapsed: Set<string>;
  toggle: (deck: string) => void;
  /** Reads them again (the deck list's refresh calls this). */
  load: () => void;
  /** Shows these until a real read lands (the deck list's saved copy, shown at launch). */
  seed: (decks: Set<string>) => void;
}

/**
 * The deck list's collapsed decks, read on their own: reading Anki's waits while a sync holds the
 * collection, and the deck list shouldn't. A read started before the latest toggle is out of date
 * and dropped; a toggle shows at once and is put back, with the reason, if it can't be saved.
 */
export function useCollapsedDecks(repo: NoteStore | null): CollapsedDecks {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const seq = useRef(0);
  const read = useRef(false);
  const load = useCallback(() => {
    if (!repo) return;
    const started = seq.current;
    collapsedDecks(repo).then((s) => { if (started === seq.current) { read.current = true; setCollapsed(s); } }).catch(() => undefined);
  }, [repo]);
  const seed = useCallback((decks: Set<string>) => { if (!read.current && seq.current === 0) setCollapsed(decks); }, []);
  const toggle = useCallback((deck: string) => {
    if (!repo) return;
    const next = !collapsed.has(deck);
    seq.current++;
    setCollapsed((prev) => { const s = new Set(prev); if (next) s.add(deck); else s.delete(deck); return s; });
    setDeckCollapsed(repo, deck, next).catch((e) => {
      Alert.alert(`Couldn't ${next ? 'collapse' : 'expand'} ${deck}`, failureText(e, { next: "It's back as it was. Try again." }));
      load();
    });
  }, [repo, collapsed, load]);
  return useMemo(() => ({ collapsed, toggle, load, seed }), [collapsed, toggle, load, seed]);
}
