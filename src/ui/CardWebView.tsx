import { Directory, File, Paths } from 'expo-file-system';
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

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
 */
export function CardWebView({ html, onMessage, onTap }: {
  html: string;
  /** What the page posts: a tts play button's `{"tts": i}` (cardDocument's speakTts). */
  onMessage?: (data: string) => void;
  /** A tap on the page that wasn't on a link, button or field. Setting it makes the page post `{"tap": true}`. */
  onTap?: () => void;
}) {
  const [uri, setUri] = useState<string>();
  const seq = useRef(0);

  useEffect(() => {
    const dir = new Directory(Paths.document, 'card-pages');
    dir.create({ idempotent: true, intermediates: true });
    // A new name per page, so the WebView loads it fresh, and the previous one is removed. The
    // counter is shared by every CardWebView: Review mounts a new one for each card side, and a
    // per-instance counter gave them all `page-1.html`, so one side's delayed delete below removed
    // the next side's page before the WebView had loaded it (error -1100).
    const n = ++seq.current;
    const file = new File(dir, `page-${++pageCount}.html`);
    let cancelled = false;
    (async () => {
      file.create({ overwrite: true });
      await file.write(html);
      // After the await: a newer page may have been written meanwhile; only the latest is shown.
      if (!cancelled && n === seq.current) setUri(file.uri);
    })();
    return () => {
      cancelled = true;
      // Leave the file until the next page replaces it, so the WebView never loses its page.
      setTimeout(() => { try { if (file.exists) file.delete(); } catch { /* already gone */ } }, 2000);
    };
  }, [html]);

  if (!uri) return <View style={{ flex: 1 }} />;
  return (
    <WebView
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
      style={{ flex: 1, backgroundColor: 'transparent' }}
    />
  );
}
