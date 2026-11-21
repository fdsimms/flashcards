import { useEffect } from 'react';

/**
 * Whether a review screen is open (under a sheet or not). Leaving the app while one is doesn't sync
 * (AppContext): a sync ends Undo, since a synced answer is in the server's history, and switching to
 * a dictionary mid-review and back would otherwise lose it. The answers sync when the review is left,
 * as they always have, or at the next launch.
 */
let open = 0;

export function useReviewOpen(): void {
  useEffect(() => {
    open++;
    return () => { open--; };
  }, []);
}

export const reviewOpen = (): boolean => open > 0;
