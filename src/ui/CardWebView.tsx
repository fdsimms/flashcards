import { Directory, File, Paths } from 'expo-file-system';
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * Shows one side of an Anki-template card. The page is written to a file and loaded from it,
 * because iOS's WebView only reads local files (the card's images and sounds in the media folder)
 * for a page that itself came from a file URL, with read access granted to the folder above both.
 * An HTML string with a file:// baseUrl doesn't get that access.
 */
export function CardWebView({ html }: { html: string }) {
  const [uri, setUri] = useState<string>();
  const seq = useRef(0);

  useEffect(() => {
    const dir = new Directory(Paths.document, 'card-pages');
    dir.create({ idempotent: true, intermediates: true });
    // A new name per page, so the WebView loads it fresh, and the previous one is removed.
    const n = ++seq.current;
    const file = new File(dir, `page-${n}.html`);
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
      style={{ flex: 1, backgroundColor: 'transparent' }}
    />
  );
}
