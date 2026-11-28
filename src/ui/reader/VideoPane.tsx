import React, { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { parsePlayerMessage, PLAYER_ORIGIN, playerErrorText, playerHtml, PLAYING } from '../../reader/video';
import { useTheme } from '../theme';
import { useOutputWake } from '../useOutputWake';

/** What Watch drives, whichever is playing: the video's player or a podcast episode's (EpisodePane). */
export type Media = {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  rate: (r: number) => void;
};

/**
 * Watch's video (docs/read-and-listen/architecture.md, "Videos"): YouTube's privacy-enhanced embedded
 * player, without its own subtitles, in a web view (`playerHtml`). The screen drives it through
 * `bind` and hears its time, whether it plays, and any error it reports.
 */
export function VideoPane({ id, bind, onTime, onPlaying, onError }: {
  id: string;
  bind: (media: Media) => void;
  onTime: (ms: number) => void;
  onPlaying: (playing: boolean) => void;
  /** A message saying why it can't play, or null once it's ready. */
  onError: (message: string | null) => void;
}) {
  const c = useTheme();
  const web = useRef<WebView<{}>>(null);
  // A Play after quiet waits for Bluetooth headphones, which lose its first words otherwise (useOutputWake).
  const wake = useOutputWake();
  const call = useCallback((js: string) => web.current?.injectJavaScript(`window.franki&&${js};true;`), []);

  useEffect(() => {
    bind({
      seek: (seconds) => call(`window.franki.seek(${Math.max(0, seconds)})`),
      play: () => { void wake().then(() => call('window.franki.play()')); },
      pause: () => call('window.franki.pause()'),
      rate: (r) => call(`window.franki.rate(${r})`),
    });
  }, [bind, call, wake]);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = parsePlayerMessage(e.nativeEvent.data);
    if (!m) return;
    if (m.type === 'time') onTime(m.ms);
    else if (m.type === 'state') onPlaying(m.state === PLAYING);
    else if (m.type === 'error') onError(playerErrorText(m.code));
    else if (m.type === 'ready') onError(null);
  };

  return (
    <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: c.videoBack }}>
      <WebView
        ref={web}
        source={{ html: playerHtml(id), baseUrl: PLAYER_ORIGIN }}
        originWhitelist={['*']}
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        onMessage={onMessage}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
