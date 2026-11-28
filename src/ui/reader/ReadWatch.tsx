import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { failureText } from '../../core/failure';
import { type Api, type GlossLanguage, type ReaderText, type Word } from '../../reader/api';
import { readFont, scaledFontSize } from '../../reader/fonts';
import { glossInfo, spokenLanguage } from '../../reader/languages';
import { prefs } from '../../reader/storage';
import { lineAt, loopBack, parsePlayerMessage, PLAYER_ORIGIN, playerErrorText, playerHtml, PLAYING, VIDEO_RATES, videoLength, youtubeLink, type VideoRate } from '../../reader/video';
import { saidAs } from '../../reader/wordAudio';
import { wrapGroups } from '../../reader/wordLayout';
import { haptic } from '../haptics';
import { Button, ErrorNote, Help, Icon, Loading, Screen, Tappable } from '../kit';
import { radius, readable, space, type, useTheme } from '../theme';
import { GlossPopover, type Tapped } from './Reader';
import { WordView, type ReadTextStyle } from './ReadWord';
import { useReadingFont } from './useReadingFont';
import { useOutputWake } from '../useOutputWake';

/**
 * Watch (docs/read-and-listen/architecture.md, "Videos"): a text made from a YouTube video's
 * subtitles, read under the video as it plays (server/reader video.py). The video plays in YouTube's
 * own embedded player (the privacy-enhanced one, without its own subtitles); the line being said is
 * shaded and kept in view, a tap on a line's time jumps there, Loop line plays it again and again,
 * 0.75× slows the video, and Hide text keeps the lines out of sight to listen first. A word's tap
 * opens its gloss, with Add to deck as the reader has it. Finished logs it as read, as the reader
 * does, which takes it off the shelf. Nothing here grades a card.
 */
export function ReadWatch({ api, textId, onPlayWord, mining, onDone }: {
  api: Api;
  textId: number;
  onPlayWord: (word: string, language: GlossLanguage, say?: string) => void;
  /** Add to deck, for the reader's language; undefined without a deck. */
  mining?: { language: GlossLanguage; onAdd: (entry: string, meaning: string, pronunciation?: Partial<Pick<Word, 'translit' | 'ipa' | 'ipa_source'>>) => void };
  onDone: () => void;
}) {
  const c = useTheme();
  const [text, setText] = useState<ReaderText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState<number | null>(null);
  const [rate, setRate] = useState<VideoRate>(1);
  const [hidden, setHidden] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const [finishing, setFinishing] = useState(false);
  const web = useRef<WebView<{}>>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  const lineTops = useRef<number[]>([]);
  const looped = useRef<number | null>(null);
  looped.current = looping;
  const glossed = useRef(new Set<string>());
  const opened = useRef(Date.now());
  const readingFont = useReadingFont(text?.language ?? 'th');
  // A jump starts the video: quiet Bluetooth headphones lose its first words otherwise (useOutputWake).
  const wake = useOutputWake();

  const load = useCallback(async () => {
    setError(null);
    try {
      setText(await api.text(textId));
    } catch (e) {
      setError(failureText(e, { what: "Couldn't open the video's text.", next: 'Try again.' }));
    }
  }, [api, textId]);
  useEffect(() => { void load(); }, [load]);

  const times = text?.video?.times ?? [];
  const call = (js: string) => web.current?.injectJavaScript(`window.franki&&${js};true;`);
  const seek = (ms: number) => call(`window.franki.seek(${Math.max(0, ms / 1000)})`);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = parsePlayerMessage(e.nativeEvent.data);
    if (!m) return;
    if (m.type === 'time') {
      const loop = looped.current;
      if (loop !== null) {
        const back = loopBack(times, loop, m.ms);
        if (back !== null) { call(`window.franki.seek(${back})`); return; }
      }
      const now = lineAt(times, m.ms);
      setLine((prev) => (prev === now ? prev : now));
    } else if (m.type === 'state') setPlaying(m.state === PLAYING);
    else if (m.type === 'error') setPlayerError(playerErrorText(m.code));
    else if (m.type === 'ready') setPlayerError(null);
  };

  // The line being said stays in view, a little below the top, unless the text is hidden.
  useEffect(() => {
    if (line < 0 || hidden) return;
    const y = lineTops.current[line];
    if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - space.xl), animated: true });
  }, [line, hidden]);

  const chooseRate = (r: VideoRate) => { setRate(r); call(`window.franki.rate(${r})`); };
  const toggleLoop = () => {
    haptic.select();
    setLooping((l) => (l === null && line >= 0 ? line : null));
  };
  const jump = (i: number) => {
    haptic.select();
    setLooping((l) => (l === null ? null : i));
    const t = times[i];
    if (!t) return;
    seek(t[0]);
    void wake().then(() => call('window.franki.play()'));
  };

  const finish = async () => {
    if (!text || finishing) return;
    setFinishing(true);
    try {
      await api.logReading(text.id, {
        finished: true,
        words_glossed: [...glossed.current],
        words_flagged: [],
        audio_speed: rate,
        listen_only: false,
        seconds: Math.round((Date.now() - opened.current) / 1000),
      });
      haptic.success();
      onDone();
    } catch (e) {
      setError(failureText(e, { what: "Couldn't mark the video as watched.", next: 'Try again.' }));
      setFinishing(false);
    }
  };

  if (!text) {
    return (
      <Screen title="Watch" largeTitle={false}>
        <View style={{ padding: space.l }}>{error ? <ErrorNote message={error} onRetry={() => void load()} /> : <Loading />}</View>
      </Screen>
    );
  }
  const video = text.video;
  const language = text.language;
  const info = glossInfo(language);
  const fontSize = scaledFontSize(info.fontSize, prefs().textSize);
  const textStyle: ReadTextStyle = { fontSize, lineHeight: fontSize * info.lineHeight, font: readFont(language, readingFont) };
  const tap = (word: Word, x: number, y: number) => {
    glossed.current.add(word.text);
    setTapped({ word, x, y });
  };
  const tappedLine = tapped ? text.lines.find((l) => l.words.includes(tapped.word)) : undefined;
  const canAdd = tapped && mining && mining.language === language && !tapped.word.deck && tapped.word.status !== 'name';

  return (
    <Screen
      title={text.title}
      largeTitle={false}
      footer={<Button label="Finished" variant="secondary" onPress={() => void finish()} busy={finishing} />}
    >
      {video ? (
        <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: c.videoBack }}>
          <WebView
            ref={web}
            source={{ html: playerHtml(video.id), baseUrl: PLAYER_ORIGIN }}
            originWhitelist={['*']}
            javaScriptEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo
            onMessage={onMessage}
            style={{ backgroundColor: 'transparent' }}
          />
        </View>
      ) : null}
      <View style={{ ...readable, flex: 1, width: '100%' }}>
        <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s }}>
          <Chip label="Loop line" on={looping !== null} disabled={looping === null && line < 0} onPress={toggleLoop} />
          {VIDEO_RATES.filter((r) => r !== 1).map((r) => <Chip key={r} label={`${r}×`} on={rate === r} onPress={() => chooseRate(rate === r ? 1 : r)} />)}
          <Chip label="Hide text" on={hidden} onPress={() => { haptic.select(); setHidden((h) => !h); }} />
        </View>
        {playerError && video ? (
          <View style={{ paddingHorizontal: space.l, gap: space.s }}>
            <ErrorNote message={playerError} />
            <Button label="Open in YouTube" variant="secondary" onPress={() => void Linking.openURL(youtubeLink(video.id))} />
          </View>
        ) : null}
        {error ? <View style={{ paddingHorizontal: space.l }}><ErrorNote message={error} /></View> : null}
        {hidden ? (
          <View style={{ padding: space.l }}><Help>The text is hidden so you can listen first. Tap Hide text again to read along.</Help></View>
        ) : (
          <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.xs }}>
            {video?.generated ? <Help>{`These are YouTube's automatic ${info.name} subtitles, so a word may be misheard.`}</Help> : null}
            {text.lines.map((l, i) => (
              <View
                key={i}
                onLayout={(e) => { lineTops.current[i] = e.nativeEvent.layout.y; }}
                style={{ flexDirection: 'row', gap: space.s, padding: space.s, borderRadius: radius.m, backgroundColor: i === line ? c.accentFill : 'transparent' }}
              >
                <Tappable onPress={() => jump(i)} accessibilityRole="button" accessibilityLabel={`Play from ${videoLength((times[i]?.[0] ?? 0) / 1000)}`} style={{ paddingTop: 3, minWidth: 40 }}>
                  <Text style={{ ...type.caption, color: i === line ? c.accentInk : c.textTertiary, fontVariant: ['tabular-nums'] }}>{videoLength((times[i]?.[0] ?? 0) / 1000)}</Text>
                </Tappable>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                    {wrapGroups(l.words).map((chunk, j) => (
                      <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {chunk.map((word, m) => (
                          <WordView key={m} word={word} textStyle={textStyle} grammar={null} flagged={false} highlighted={false} named={false} selected={tapped?.word === word} onPress={tap} />
                        ))}
                      </View>
                    ))}
                  </View>
                  {l.english ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{l.english}</Text> : null}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
      <GlossPopover
        tapped={tapped}
        language={spokenLanguage(language)}
        meaningLookup={(word) => api.wordMeaning(language, word.text, tappedLine?.english)}
        grammar={null}
        api={api}
        grammarChosen={{}}
        onGrammarChosen={() => undefined}
        flagged={false}
        onToggleFlag={null}
        onPlay={() => {
          if (playing) call('window.franki.pause()');
          if (tapped) onPlayWord(tapped.word.text, language, saidAs(language, tapped.word.text, tapped.word.translit));
        }}
        onAddToDeck={canAdd ? () => {
          const word = tapped!.word;
          setTapped(null);
          mining!.onAdd(word.text, word.gloss ?? '', word);
        } : null}
        onClose={() => setTapped(null)}
      />
    </Screen>
  );
}

function Chip({ label, on, disabled, onPress }: { label: string; on: boolean; disabled?: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      restOpacity={disabled ? 0.45 : 1}
      style={{ paddingHorizontal: space.m, paddingVertical: space.xs + 2, borderRadius: radius.pill, backgroundColor: on ? c.accent : c.fill, flexDirection: 'row', alignItems: 'center', gap: space.xs }}
    >
      {on ? <Icon name="checkmark" size={11} color={c.onAccent} weight="bold" /> : null}
      <Text style={{ ...type.footnote, fontWeight: '600', color: on ? c.onAccent : c.text }}>{label}</Text>
    </Tappable>
  );
}
