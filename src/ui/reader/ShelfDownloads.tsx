import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { languagesToKeep, mayDownload, planTexts } from '../../reader/downloads';
import { hasSlow } from '../../reader/prefs';
import { prefs } from '../../reader/storage';
import { useApp } from '../AppContext';
import { connection, useBackOnline } from '../connection';
import { downloads, useDownloads } from './readerDownloads';

/** Asks the mounted ShelfDownloads to look again now (the setting changed). */
let kick: () => void = () => {};
export const downloadNow = () => kick();

/**
 * Keeps the shelf's texts on the phone (src/reader/downloads.ts) under Settings, Read & Listen,
 * Download for offline: on Wi-Fi only by default. It reads the shelves at launch, on coming back to
 * the app and when the connection comes back (the reader's language, then every language with texts
 * ready, so a language can be switched to offline), and plans again whenever any screen reads one;
 * then downloads what's missing, one text at a time, and deletes what has left its shelf. The slow
 * recordings come too for a language with Slow speed on. Drawn once, under AppProvider, and draws
 * nothing.
 */
export function ShelfDownloads() {
  const { reader } = useApp();
  const server = reader.serverApi;
  const shelves = useDownloads().shelves;
  const language = useRef(reader.settings?.language);
  language.current = reader.settings?.language;
  const running = useRef(false);
  const again = useRef(false);

  const run = async (readShelf: boolean) => {
    if (!server) return;
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do {
        again.current = false;
        await downloads.load();
        if (connection.cantReachHome() || !mayDownload(prefs().offlineDownloads, connection.get().path)) return;
        const kept = downloads.get().shelves;
        let current = (language.current && kept[language.current]) || Object.values(kept)[0];
        const fresh = readShelf || !current;
        if (fresh || !current) {
          current = await server.shelf();
          downloads.setShelf(current);
        }
        // The reader's own language first, then every other one with texts ready, each read without
        // switching to it (and nothing is written for it).
        for (const lang of languagesToKeep(current, downloads.get())) {
          let shelf = lang === current.language ? current : downloads.get().shelves[lang];
          if (!shelf || (fresh && lang !== current.language)) {
            shelf = await server.shelf(lang);
            downloads.setShelf(shelf);
          }
          const plan = planTexts(shelf, downloads.get());
          downloads.dropTexts(plan.drop);
          for (const card of plan.fetch) {
            // The setting or the network can change between texts.
            if (!mayDownload(prefs().offlineDownloads, connection.get().path)) return;
            await downloads.saveText(server, card, hasSlow(prefs(), lang));
          }
        }
        readShelf = false;
      } while (again.current);
    } catch {
      // Offline again, or the server refused: the next launch, return or reconnection tries again.
    } finally {
      running.current = false;
    }
  };
  const latest = useRef(run);
  latest.current = run;

  useEffect(() => {
    kick = () => { void latest.current(false); };
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void latest.current(true); });
    return () => { sub.remove(); kick = () => {}; };
  }, []);
  // At launch (and a new sign-in), and whenever a screen has read the shelf.
  useEffect(() => { void latest.current(true); }, [server]);
  useEffect(() => { void latest.current(false); }, [shelves]);
  useBackOnline(() => { void latest.current(true); });
  // Joining Wi-Fi doesn't count as coming back when the phone was already online on cellular.
  useEffect(() => {
    let path = connection.get().path;
    return connection.subscribe(() => {
      const now = connection.get().path;
      if (now === 'wifi' && path !== 'wifi') void latest.current(false);
      path = now;
    });
  }, []);
  return null;
}
