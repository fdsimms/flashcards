import { Directory, File, Paths } from 'expo-file-system';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { failureText } from '../core/failure';
import { pageFont } from '../core/cardFonts';
import { pageUsesMathJax } from '../core/mathjax';
import { START_AUTOPLAY } from '../core/template';
import { installCardFont } from '../media/cardFonts';
import { installMathJax } from '../media/mathjax';
import { space, type, useTheme } from './theme';

let pageCount = 0;

const TAP_MESSAGE = '{"tap":true}';
// Posts a tap that isn't on something with its own action (a link, the tts play button, a field, media).
const TAP_SCRIPT = `
document.addEventListener('click', function (e) {
  if (e.defaultPrevented || window.getSelection().toString()) return;
  if (e.target.closest('a, button, input, select, textarea, label, audio, video, [onclick], [contenteditable]')) return;
  window.ReactNativeWebView.postMessage('${TAP_MESSAGE}');
});
true;
`;

/**
 * Shows one side of an Anki-template card. The page is written to a file and loaded from it,
 * because iOS's WebView only reads local files (the card's images and sounds in the media folder)
 * for a page that itself came from a file URL, with read access granted to the folder above both.
 * An HTML string with a file:// baseUrl doesn't get that access.
 *
 * A new `html` loads into the same WebView, and the page already shown stays until the new one is
 * written and has loaded (WKWebView keeps the old page up while the next navigates), so showing a
 * card's back doesn't blank the card. Key it to start a new card from an empty view instead.
 *
 * `hidden` loads a page out of sight (Review's next card, ahead of its answer): it fills the same
 * space, takes no taps, is skipped by VoiceOver, and its sounds wait until it's shown.
 */
export function CardWebView({ html, hidden = false, onShown, onMessage, onTap }: {
  html: string;
  /** Loaded but not shown yet. Shown, the same view keeps its page: nothing reloads. */
  hidden?: boolean;
  /** A page is loaded and shown (each side's, each time). */
  onShown?: () => void;
  /** What the page posts: a tts play button's `{"tts": i}` (cardDocument's speakTts). */
  onMessage?: (data: string) => void;
  /** A tap on the page that wasn't on a link, button or field. Setting it makes the page post `{"tap": true}`. */
  onTap?: () => void;
}) {
  const c = useTheme();
  const [uri, setUri] = useState<string>();
  const [error, setError] = useState<string>();
  const seq = useRef(0);
  const view = useRef<WebView<{}>>(null);
  // Pages finished loading, counted. Autoplay starts once a page is both loaded and shown, whichever
  // comes last; telling a page that has already started again does nothing (cardDocument).
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    if (hidden || loads === 0) return;
    view.current?.injectJavaScript(START_AUTOPLAY);
    onShown?.();
  }, [hidden, loads]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const dir = new Directory(Paths.document, 'card-pages');
    dir.create({ idempotent: true, intermediates: true });
    // A new name per page, so the WebView loads it fresh, and the previous one is removed. The
    // counter is shared by every CardWebView: Review mounts a new one for each card, and a
    // per-instance counter gave them all `page-1.html`, so one page's delayed delete below removed
    // the next one's page before the WebView had loaded it (error -1100).
    const n = ++seq.current;
    const file = new File(dir, `page-${++pageCount}.html`);
    let cancelled = false;
    (async () => {
      // A side with math loads the bundled MathJax from the documents folder; without it the page
      // still shows, with the TeX as written.
      if (pageUsesMathJax(html)) {
        await installMathJax().catch((e) => console.warn('MathJax not installed', e));
        if (cancelled) return; // replaced meanwhile: don't write a page nothing will delete
      }
      // A side set in one of the bundled fonts loads its files from the documents folder; without them it shows in the system font.
      const font = pageFont(html);
      if (font) {
        await installCardFont(font).catch((e) => console.warn('Card font not installed', e));
        if (cancelled) return;
      }
      file.create({ overwrite: true });
      await file.write(html);
      // After the await: a newer page may have been written meanwhile; only the latest is shown.
      if (!cancelled && n === seq.current) { setUri(file.uri); setError(undefined); }
    })().catch((e) => {
      if (!cancelled && n === seq.current) setError(failureText(e, { what: "Couldn't show this card.", next: 'Close the deck and open it again.' }));
    });
    return () => {
      cancelled = true;
      // Leave the file until the next page replaces it, so the WebView never loses its page.
      setTimeout(() => { try { if (file.exists) file.delete(); } catch { /* already gone */ } }, 2000);
    };
  }, [html]);

  return (
    <View
      style={hidden ? [StyleSheet.absoluteFill, { opacity: 0 }] : StyleSheet.absoluteFill}
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      {error ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
          <Text style={{ ...type.subhead, color: c.danger, textAlign: 'center' }}>{error}</Text>
        </View>
      ) : uri ? (
        <WebView
          ref={view}
          source={{ uri }}
          originWhitelist={['*']}
          allowingReadAccessToURL={Paths.document.uri}
          allowFileAccess
          allowFileAccessFromFileURLs
          mediaPlaybackRequiresUserAction={false}
          injectedJavaScript={onTap ? TAP_SCRIPT : undefined}
          onMessage={(e) => {
            const data = e.nativeEvent.data;
            if (onTap && data === TAP_MESSAGE) onTap();
            else onMessage?.(data);
          }}
          onLoadEnd={() => setLoads((n) => n + 1)}
          style={{ flex: 1, backgroundColor: 'transparent' }}
        />
      ) : null}
    </View>
  );
}
