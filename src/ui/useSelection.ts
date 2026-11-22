import { useCallback, useEffect, useState } from 'react';
import { stillListed, toggled } from '../core/selection';

/**
 * Select mode for a list: whether it's on, and which rows are picked. `ids` is every row the list
 * has now, so a row that goes away (a delete, a sync) leaves the selection too.
 */
export function useSelection(ids: readonly string[]) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected((now) => {
      const next = stillListed(now, ids);
      return next.size === now.size ? now : next;
    });
  }, [ids]);
  const start = useCallback(() => setSelecting(true), []);
  const stop = useCallback(() => { setSelecting(false); setSelected(new Set()); }, []);
  const toggle = useCallback((id: string) => setSelected((now) => toggled(now, id)), []);
  const selectAll = useCallback((all: readonly string[]) => setSelected(new Set(all)), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selecting, selected, start, stop, toggle, selectAll, clear };
}
