import { useCallback, useRef } from 'react';
import type { GlossLanguage } from '../../reader/api';
import { mayKeepWhilePlaying, shelfCardFor } from '../../reader/downloads';
import { hasSlow } from '../../reader/prefs';
import { prefs } from '../../reader/storage';
import { useApp } from '../AppContext';
import { connection } from '../connection';
import { downloads } from './readerDownloads';

/**
 * Starting to play a shelf text, or a past one (Past texts, Listen again), keeps it on the phone (src/reader/downloads.ts, mayKeepWhilePlaying):
 * the text with its end-of-reading questions, and every line's recording (the slow ones too where the
 * language has Slow), so going underground mid-listen doesn't end it. The shelf's automatic downloads
 * only run under their own setting (Wi-Fi only by default), which left a text played on cellular
 * streaming from the server. A past text is kept as one (the latest few). Returns what the reader calls as a line starts; a download cut short is
 * tried again the next time a line starts.
 */
export function useKeepPlaying() {
  const { reader } = useApp();
  const server = reader.serverApi;
  const started = useRef<number | null>(null);
  return useCallback((textId: number, language: GlossLanguage, past: boolean) => {
    if (!server || started.current === textId) return;
    // A shelf text needs its card from the shelf last read; a past text has none and is kept as a past one.
    const card = past ? textId : shelfCardFor(downloads.get(), textId);
    if (card === null || downloads.get().texts.some((t) => t.id === textId && t.complete)) return;
    if (!mayKeepWhilePlaying(prefs().offlineDownloads, connection.get().path)) return;
    started.current = textId;
    downloads.saveText(server, card, hasSlow(prefs(), language)).catch(() => {
      // Offline again: tried once more when a line next starts.
      if (started.current === textId) started.current = null;
    });
  }, [server]);
}
