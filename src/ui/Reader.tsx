import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { usePreventRemove } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import type { SFSymbol } from 'expo-symbols';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, type Api, type PastText, type Rating, type ReaderText, type TextGrammar, type Topic, type Word } from '../reader/api';
import { countOutsideDeck, isOutsideDeck, underFloor } from '../reader/deckWords';
import { scrollTarget, type Box } from '../reader/follow';
import { LANGUAGES, wordStatus } from '../reader/languages';
import { firstLine, nextLine } from '../reader/playback';
import { RATES } from '../reader/playbackRate';
import { formatDuration, heard, isFlagged, listenedOnly, lookUp, startSession, toggleFlag, toLog, type Session } from '../reader/session';
import { prefs, savePrefs } from '../reader/storage';
import { wrapGroups } from '../reader/wordLayout';
import { haptic } from './haptics';
import { Button, Card, ErrorNote, HeaderAction, Help, Icon, Screen, Segments, Tappable } from './kit';
import { lift, MIN_TAP, radius, space, type, useTheme, type Colors } from './theme';

/**
 * The reader: a text split into words by the server, a gloss on tap, audio line by line, and a
 * rating at the end (docs/read-and-listen/architecture.md, Client). Nothing here answers a card.
 *
 * Layout: the title, practice words, the Show English and highlight switches, the lines (each with
 * its own replay button, and an EN button that shows that line's English alone), then Done, with
 * the player pinned under the scroll view. Done swaps the lines for the end view (rating, stats,
 * words marked unknown). The gloss popover is a transparent Modal, so a tap's page coordinates
 * place it directly.
 *
 * Reading again: a past text opens here with nothing logged (no Done, no rating, no marking words
 * unknown), since a second reading isn't recorded. One rated About right can be played with the
 * text hidden straight away.
 *
 * Listen only: once a text is rated About right, the end view offers to play it again with the
 * text hidden (brief, design principle 6). The lines show who's speaking instead, and Show the text
 * brings the words back. The reading is logged as listen-only.
 *
 * Audio: one player is reused for every line. Play runs the text from the current line to the end
 * (`nextLine`); a line's replay button plays that line alone. Speed is the player's rate, with
 * pitch kept, so each line is one file whatever the speed. The audio session stays active between
 * lines (`keepAudioSessionActive`), or iOS can suspend the app in the gap with the screen locked,
 * and plays in the background while this screen is open. A line that fails to load counts as
 * finished, so Play moves on. When the playing line changes, the text scrolls to it if it's out of
 * view (`scrollTarget`).
 *
 * Loading: `/next` answers 202 while the server writes a text, so `load` asks again every few
 * seconds. `loadId` and `mounted` make a load that's been superseded (Next, then Back) drop its result.
 */

type Tapped = { word: Word; x: number; y: number };

const POLL_MS = 3_000;
// Three attempts and the audio rarely take more than two minutes; past this, something is wrong.
const WRITE_WAIT_MS = 4 * 60_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A new text on a topic (practicing `words` when given, the cards just studied), or a past text to read again. */
export type ReaderSource = { kind: 'topic'; topic: Topic; words?: string[] } | { kind: 'past'; text: PastText };

export function Reader({ api, source, onDone }: { api: Api; source: ReaderSource; onDone: () => void }) {
  const review = source.kind === 'past';
  const c = useTheme();
  const [text, setText] = useState<ReaderText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [english, setEnglish] = useState(false);
  // Lines whose English was shown on their own, while Show English is off.
  const [lineEnglish, setLineEnglish] = useState<number[]>([]);
  const [listenOnly, setListenOnly] = useState(false);
  const [highlight, setHighlight] = useState(prefs().highlight);
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const [ended, setEnded] = useState(false);
  const [rating, setRating] = useState<Rating | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [writing, setWriting] = useState(false);
  const logged = useRef(false);
  const mounted = useRef(true);
  const loadId = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  // Listening goes on with the screen locked or in another app, while the reader is open. Review's
  // card audio doesn't need it, so it's turned off again on the way out.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => undefined);
    return () => { setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => undefined); };
  }, []);

  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<number | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const [rate, setRate] = useState(prefs().rate);
  const [silentLine, setSilentLine] = useState<number | null>(null);
  const [repeat, setRepeat] = useState(false);

  const scroller = useRef<ScrollViewInstance>(null);
  const lineBoxes = useRef<Box[]>([]);
  const scrollY = useRef(0);
  const viewHeight = useRef(0);

  useEffect(() => {
    const box = current === null ? undefined : lineBoxes.current[current];
    if (!box || !viewHeight.current) return;
    const y = scrollTarget(box, scrollY.current, viewHeight.current);
    if (y !== null) scroller.current?.scrollTo({ y, animated: true });
  }, [current]);

  const playLine = (i: number, all: boolean) => {
    if (!text) return;
    setSilentLine(null);
    player.replace(api.audioSource(text.id, i));
    player.setPlaybackRate(rate, 'high');
    player.play();
    setCurrent(i);
    setPlayingAll(all);
    setSession((s) => (s ? heard(s, rate) : s));
  };

  const togglePlay = () => {
    if (!text) return;
    if (status.playing) player.pause();
    else if (current !== null && !status.didJustFinish && status.currentTime < status.duration) {
      player.setPlaybackRate(rate, 'high');
      player.play();
      setSession((s) => (s ? heard(s, rate) : s));
    } else {
      const start = firstLine(text.lines, current === null ? 0 : current + 1) ?? firstLine(text.lines);
      if (start !== null) playLine(start, true);
    }
  };

  const changeRate = (next: number) => {
    savePrefs({ rate: next });
    setRate(next);
    player.setPlaybackRate(next, 'high');
    if (status.playing) setSession((s) => (s ? heard(s, next) : s));
  };

  useEffect(() => {
    if (!status.didJustFinish || current === null || !text) return;
    const next = nextLine(text.lines, current, playingAll, repeat);
    if (next === current) {
      // The same source again: rewind rather than reload it.
      player.seekTo(0).then(() => player.play(), () => undefined);
      return;
    }
    if (next !== null) playLine(next, true);
    else setPlayingAll(false);
  }, [status.didJustFinish]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to a line ending only

  // A line whose audio didn't load (the server had none for it): note it and move on.
  useEffect(() => {
    if (!status.error || current === null || !text) return;
    setSilentLine(current);
    const next = nextLine(text.lines, current, playingAll);
    if (next !== null) playLine(next, true);
    else setPlayingAll(false);
  }, [status.error]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to a load error only

  const load = async () => {
    const id = ++loadId.current;
    const stillWanted = () => mounted.current && id === loadId.current;
    player.pause();
    setCurrent(null);
    setPlayingAll(false);
    setSilentLine(null);
    setText(null);
    setError(null);
    setEnded(false);
    setRating(null);
    setWriting(false);
    setLineEnglish([]);
    setListenOnly(false);
    lineBoxes.current = [];
    scrollY.current = 0;
    logged.current = false;
    try {
      if (source.kind === 'past') {
        const past = await api.text(source.text.id);
        if (!stillWanted()) return;
        setText(past);
        setSession(startSession(past, Date.now()));
        return;
      }
      const topicId = source.topic.id;
      const deadline = Date.now() + WRITE_WAIT_MS;
      const words = source.words;
      let next = await api.nextText(topicId, words);
      while (next === null) {
        if (!stillWanted()) return;
        setWriting(true);
        if (Date.now() > deadline) throw new ApiError('Writing this text is taking longer than usual. Try again in a minute.', 0);
        await wait(POLL_MS);
        if (!stillWanted()) return;
        next = await api.nextText(topicId, words);
      }
      if (!stillWanted()) return;
      setText(next);
      setSession(startSession(next, Date.now()));
    } catch (e) {
      if (stillWanted()) setError(e instanceof ApiError ? e.message : "Couldn't get a text. Try again.");
    }
  };

  useEffect(() => { load(); }, [source]); // eslint-disable-line react-hooks/exhaustive-deps -- loads once per source

  // Finishing a text (Done) logs it once, which also takes it off the ready queue. Backing out
  // before Done logs nothing, so the same text is waiting next time instead of a new one.
  const finish = async (then: 'next' | 'back', leaveWith?: () => void) => {
    // How the screen is left: the router's own continuation when the swipe or Back button asked
    // (it also turns the guard off), else turning the guard off and going back.
    const leave = leaveWith ?? (() => { stopGuarding(); onDone(); });
    player.pause();
    if (leaving) {
      // Back while Next text is still logging: drop the load that would follow it.
      if (then === 'back') {
        loadId.current++;
        leave();
      }
      return;
    }
    // A listen-only pass is only offered after Done, so it counts as finished too. Reading a past
    // text again is never logged.
    const finished = ended || (session?.listenOnly ?? false);
    if (text && session && finished && !review && !logged.current) {
      logged.current = true;
      setLeaving(true);
      try {
        await api.logReading(text.id, toLog(session, Date.now(), rating, true));
      } catch {
        // The reading is lost, not your place: carry on either way.
      } finally {
        if (mounted.current) setLeaving(false);
      }
    }
    if (!mounted.current) return;
    if (then === 'next') load();
    else leave();
  };

  // A finished text is logged before the screen goes, however it goes: the Back button, the swipe,
  // or Back to topics. Without this a swipe skipped the log and the text stayed queued.
  const needsLog = !!text && !!session && (ended || session.listenOnly) && !review && !logged.current;
  const stopGuarding = usePreventRemove(needsLog || leaving, ({ repeat }) => { finish('back', repeat); });

  const tap = (word: Word, x: number, y: number) => {
    if (!session) return;
    setSession(lookUp(session, word.text));
    setTapped({ word, x, y });
  };

  const toggleLineEnglish = (i: number) => {
    setLineEnglish((shown) => (shown.includes(i) ? shown.filter((n) => n !== i) : [...shown, i]));
  };

  const listenWithoutText = () => {
    if (!text) return;
    setSession((s) => (s ? listenedOnly(s) : s));
    setListenOnly(true);
    setEnded(false);
    scrollY.current = 0; // the lines' scroll view is mounted fresh
    const start = firstLine(text.lines);
    if (start !== null) playLine(start, true);
  };

  const turnOnHighlight = (on: boolean) => {
    savePrefs({ highlight: on });
    setHighlight(on);
  };

  const seconds = session ? Math.round((Date.now() - session.startedAt) / 1000) : 0;
  const hasAudio = text ? firstLine(text.lines) !== null : false;
  const language = LANGUAGES[text?.language ?? 'th'];

  return (
    <Screen
      largeTitle={false}
      footer={text && !ended ? (
        hasAudio ? (
          <PlayerBar playing={status.playing} current={current} total={text.lines.length} what={text.form === 'story' ? 'story' : 'dialogue'}
            rate={rate} repeat={repeat} silentLine={silentLine} onToggle={togglePlay} onRate={changeRate} onRepeat={() => setRepeat((r) => !r)} />
        ) : <Help>No audio for this text.</Help>
      ) : undefined}
    >
      {/* A ScrollView with the automatic inset, not a bare View: a bare one draws under the native
          header, so the spinner and message sat behind the Back button and the screen looked blank. */}
      {!text ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          {error ? (
            <View style={{ padding: space.l }}><ErrorNote message={error} onRetry={load} /></View>
          ) : (
            <View style={{ padding: space.xxl, alignItems: 'center', gap: space.m }}>
              <ActivityIndicator color={c.accent} />
              <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
                {writing ? 'Writing a text. This takes about half a minute.' : 'Opening the text'}
              </Text>
            </View>
          )}
        </ScrollView>
      ) : null}

      {text && session && !ended ? (
        <ScrollView
          ref={scroller}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: space.l }}
          onLayout={(e) => { viewHeight.current = e.nativeEvent.layout.height; }}
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={100}
        >
          <View style={{ paddingHorizontal: space.l, gap: space.s }}>
            <Text style={{ ...type.title, color: c.text }}>{text.title}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{source.kind === 'topic' ? source.topic.name : source.text.topic}</Text>
            {text.stretch.length > 0 ? (
              <ChipRow label="Practice words:">
                {text.stretch.map((w) => <Pill key={w} text={w} bg={c.accentFill} fg={c.accent} />)}
              </ChipRow>
            ) : null}
            {practicedGrammar(text).length > 0 ? (
              <ChipRow label="Grammar:">
                {practicedGrammar(text).map((g) => <Pill key={g.id} text={g.name} bg={c.speakerB} fg={c.onSpeakerB} />)}
              </ChipRow>
            ) : null}
            {text.roles.A || text.roles.B ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.l }}>
                {(['A', 'B'] as const).map((who) => text.roles[who] ? (
                  <View key={who} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    <SpeakerBadge who={who} />
                    <Text style={{ ...type.subhead, color: c.textSecondary }}>{text.roles[who]}</Text>
                  </View>
                ) : null)}
              </View>
            ) : null}
            {review && !listenOnly && source.text.rating === 'about_right' && hasAudio ? (
              <ToggleRow label="You rated this about right">
                <HeaderAction label="Listen without the text" onPress={listenWithoutText} />
              </ToggleRow>
            ) : null}
            {listenOnly ? (
              <ToggleRow label="Listening without the text">
                <HeaderAction label="Show the text" onPress={() => setListenOnly(false)} />
              </ToggleRow>
            ) : (
              <>
                <ToggleRow label="Show English">
                  <Switch value={english} onValueChange={setEnglish} trackColor={{ true: c.accent }} accessibilityLabel="Show English" />
                </ToggleRow>
                <ToggleRow label={language.highlightLabel}>
                  <Switch value={highlight} onValueChange={turnOnHighlight} trackColor={{ true: c.accent }} accessibilityLabel={language.highlightLabel} />
                </ToggleRow>
                {highlight && countOutsideDeck(text) === 0 ? (
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>Every word in this text is in your deck.</Text>
                ) : null}
                {underFloor(text) ? (
                  <Card style={{ padding: space.m, gap: space.s }}>
                    <Help>{`${Math.round(text.coverage * 100)}% of the words in this one are in your deck, fewer than usual. Tap any word for its meaning.`}</Help>
                    {highlight ? null : <View style={{ alignItems: 'flex-start' }}><HeaderAction label="Highlight them" onPress={() => turnOnHighlight(true)} /></View>}
                  </Card>
                ) : null}
              </>
            )}
          </View>
          {text.lines.map((line, i) => (
            <View
              key={i}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                lineBoxes.current[i] = { y, height };
              }}
              style={{
                flexDirection: 'row', gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m,
                borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
                backgroundColor: current === i ? c.surface : undefined,
              }}
            >
              {line.speaker === 'N' ? null : <View style={{ paddingTop: space.s }}><SpeakerBadge who={line.speaker} /></View>}
              <View style={{ flex: 1 }}>
                {listenOnly ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary, paddingVertical: space.s }}>
                    {(line.speaker !== 'N' && text.roles[line.speaker]) || `Line ${i + 1}`}
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                    {wrapGroups(line.words).map((group, j) => (
                      // A line breaks only between groups, so punctuation never wraps away from its word.
                      <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {group.map((word, k) => (
                          <WordView
                            key={k}
                            word={word}
                            textStyle={readStyle(text)}
                            grammar={grammarOf(text, word)}
                            flagged={isFlagged(session, word.text)}
                            highlighted={highlight && isOutsideDeck(word)}
                            selected={tapped?.word === word}
                            onPress={tap}
                          />
                        ))}
                      </View>
                    ))}
                  </View>
                )}
                {!listenOnly && (english || lineEnglish.includes(i)) ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary, marginTop: 2 }}>{line.english}</Text>
                ) : null}
              </View>
              <View style={{ gap: space.xs }}>
                {line.audio ? (
                  <RoundButton icon="play.fill" accessibilityLabel={`Play line ${i + 1}`} on onPress={() => playLine(i, false)} />
                ) : null}
                {!english && !listenOnly ? (
                  <RoundButton
                    label="EN"
                    accessibilityLabel={lineEnglish.includes(i) ? `Hide English for line ${i + 1}` : `Show English for line ${i + 1}`}
                    on={lineEnglish.includes(i)}
                    onPress={() => toggleLineEnglish(i)}
                  />
                ) : null}
              </View>
            </View>
          ))}
          {review ? null : (
            <View style={{ padding: space.l }}>
              <Button label="Done" onPress={() => { player.pause(); setEnded(true); }} />
            </View>
          )}
        </ScrollView>
      ) : null}

      {text && session && ended ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
          <Card style={{ gap: space.s }}>
            <Text style={{ ...type.title, color: c.text }}>How was this one?</Text>
            <Help>Your answer sets how hard the next text is.</Help>
            <View accessibilityRole="radiogroup" style={{ gap: space.s }}>
              {RATINGS.map((r) => {
                const selected = rating === r.value;
                return (
                  <Tappable
                    key={r.value}
                    onPress={() => { haptic.select(); setRating(selected ? null : r.value); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${r.label}. ${r.hint}`}
                    scaleTo={0.98}
                    style={{
                      borderWidth: 1, borderRadius: radius.m, paddingHorizontal: space.l, paddingVertical: space.m, gap: 2,
                      borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accentFill : undefined,
                    }}
                  >
                    <Text style={{ ...type.headline, color: selected ? c.accent : c.text }}>{r.label}</Text>
                    <Text style={{ ...type.footnote, color: selected ? c.accent : c.textSecondary }}>{r.hint}</Text>
                  </Tappable>
                );
              })}
            </View>
          </Card>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Stat value={`${Math.round(text.coverage * 100)}%`} label="Words you know" />
            <Stat value={String(session.glossed.length)} label="Words looked up" />
            <Stat value={formatDuration(seconds)} label="Time" />
          </View>
          {session.flagged.length > 0 ? (
            <Card style={{ gap: 0 }}>
              <Text style={{ ...type.headline, color: c.text, paddingBottom: space.s }}>Marked as unknown</Text>
              {session.flagged.map((w, i) => (
                <View key={w} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}>
                  <Text style={{ ...type.body, color: c.text }}>{w}</Text>
                  <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{glossFor(text, w) ?? ''}</Text>
                </View>
              ))}
              <View style={{ paddingTop: space.s }}><Help>These are kept in Marked words, where the ones not in your deck can be added to it.</Help></View>
            </Card>
          ) : null}
          {rating === 'about_right' && hasAudio ? (
            <View style={{ gap: space.xs }}>
              <Button label="Listen without the text" variant="secondary" onPress={listenWithoutText} />
              <Help>Plays it again with the text hidden.</Help>
            </View>
          ) : null}
          <Button label="Next text" onPress={() => finish('next')} busy={leaving} />
          <Button label="Back to topics" variant="secondary" onPress={() => finish('back')} />
        </ScrollView>
      ) : null}

      <GlossPopover
        tapped={tapped}
        grammar={tapped && text ? grammarOf(text, tapped.word) : null}
        flagged={tapped && session ? isFlagged(session, tapped.word.text) : false}
        onToggleFlag={review ? null : () => { if (tapped && session) setSession(toggleFlag(session, tapped.word.text)); }}
        onClose={() => setTapped(null)}
      />
    </Screen>
  );
}

const RATINGS: { value: Rating; label: string; hint: string }[] = [
  { value: 'too_easy', label: 'Too easy', hint: 'More new words next time' },
  { value: 'about_right', label: 'About right', hint: 'Keep it like this' },
  { value: 'too_hard', label: 'Too hard', hint: 'Fewer new words next time' },
];

/** The reading size for a text's language. */
function readStyle(text: ReaderText) {
  const info = LANGUAGES[text.language ?? 'th'];
  return { fontSize: info.fontSize, lineHeight: info.fontSize * info.lineHeight };
}

function practicedGrammar(text: ReaderText): TextGrammar[] {
  return (text.grammar ?? []).filter((g) => g.role === 'practice');
}

function grammarOf(text: ReaderText, word: Word): TextGrammar | null {
  return word.grammar ? ((text.grammar ?? []).find((g) => g.id === word.grammar) ?? null) : null;
}

function glossFor(text: ReaderText, word: string): string | null {
  for (const line of text.lines) for (const w of line.words) if (w.text === word && w.gloss) return w.gloss;
  return null;
}

function speakerColors(c: Colors, who: 'A' | 'B') {
  return who === 'A' ? { bg: c.accentFill, fg: c.accent } : { bg: c.speakerB, fg: c.onSpeakerB };
}

function SpeakerBadge({ who }: { who: 'A' | 'B' }) {
  const c = useTheme();
  const { bg, fg } = speakerColors(c, who);
  return (
    <View style={{ minWidth: 26, minHeight: 26, borderRadius: radius.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs }}>
      <Text style={{ ...type.footnote, fontWeight: '700', color: fg }}>{who}</Text>
    </View>
  );
}

function Pill({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <Text style={{ ...type.subhead, fontWeight: '700', color: fg, backgroundColor: bg, paddingHorizontal: space.s, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' }}>
      {text}
    </Text>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{label}</Text>
      {children}
    </View>
  );
}

function ToggleRow({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.m, minHeight: MIN_TAP }}>
      <Text style={{ ...type.subhead, color: c.textSecondary, flexShrink: 1 }}>{label}</Text>
      {children}
    </View>
  );
}

/** A line's replay and EN buttons: a full tap target, filled when on. One of `icon` or `label`. */
function RoundButton({ icon, label, accessibilityLabel, on, onPress }: {
  icon?: SFSymbol;
  label?: string;
  accessibilityLabel: string;
  on: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  const fg = on ? c.accent : c.textSecondary;
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      scaleTo={0.92}
      style={{
        minWidth: MIN_TAP, minHeight: MIN_TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: on ? c.accentFill : c.fill,
      }}
    >
      {icon ? <Icon name={icon} size={16} color={fg} weight="semibold" /> : <Text style={{ ...type.footnote, fontWeight: '700', color: fg }}>{label}</Text>}
    </Tappable>
  );
}

function WordView({ word, grammar, textStyle, flagged, highlighted, selected, onPress }: {
  word: Word;
  grammar: TextGrammar | null;
  textStyle: { fontSize: number; lineHeight: number };
  flagged: boolean;
  highlighted: boolean;
  selected: boolean;
  onPress: (word: Word, x: number, y: number) => void;
}) {
  const c = useTheme();
  if (word.status === null) {
    // A space becomes a gap; punctuation is shown but can't be tapped.
    return word.text.trim()
      ? <Text style={{ ...textStyle, color: c.text }}>{word.text}</Text>
      : <View style={{ width: textStyle.fontSize * 0.3 }} />;
  }
  return (
    <Pressable
      onPress={(e) => onPress(word, e.nativeEvent.pageX, e.nativeEvent.pageY)}
      accessibilityRole="button"
      accessibilityLabel={[word.text, word.stretch && 'practice word', grammar && grammar.name, highlighted && 'not in your deck', flagged && 'marked unknown']
        .filter(Boolean).join(', ')}
      accessibilityHint="Shows what this word means"
      style={{
        // Thai has no spaces between words. The negative margin cancels the border, so tappable
        // words sit flush and only real spaces in the text show as gaps.
        borderRadius: radius.s - 2, borderWidth: 1.5, marginHorizontal: -1.5,
        borderColor: selected ? c.accent : 'transparent',
        backgroundColor: selected ? c.accentFill : highlighted ? c.highlight : undefined,
      }}
    >
      <Text
        style={[
          { ...textStyle, color: word.stretch ? c.accent : c.text },
          word.stretch ? { fontWeight: '700' } : null,
          // The underline is a bottom border, not textDecoration: iOS draws a text underline through
          // Thai's below-the-line vowels and consonant feet. The border is always there (transparent
          // when unused) so every word is the same height and a row stays aligned.
          // Grammar is underlined solid when practiced, dashed when it slipped in while avoided; a
          // practice word's or a marked word's dotted underline takes its place.
          { borderBottomWidth: 1.5, borderBottomColor: 'transparent' },
          grammar ? {
            borderStyle: grammar.role === 'practice' ? 'solid' : 'dashed',
            borderBottomColor: grammar.role === 'practice' ? c.onSpeakerB : c.textTertiary,
          } : null,
          word.stretch || flagged ? { borderStyle: 'dotted', borderBottomColor: flagged ? c.danger : c.accent } : null,
        ]}
      >
        {word.text}
      </Text>
    </Pressable>
  );
}

const POPOVER_WIDTH = 290;
// Space between the tap and the popover's edge, enough to clear the tapped word.
const POPOVER_GAP = 28;

function GlossPopover({ tapped, grammar, flagged, onToggleFlag, onClose }: {
  tapped: Tapped | null;
  grammar: TextGrammar | null;
  flagged: boolean;
  /** null when marking isn't recorded (reading a past text). */
  onToggleFlag: (() => void) | null;
  onClose: () => void;
}) {
  const c = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Measured on first layout (drawn invisible until then), since a long gloss wraps.
  const [popHeight, setPopHeight] = useState(0);
  useEffect(() => setPopHeight(0), [tapped]);
  if (!tapped) return null;
  const popWidth = Math.min(POPOVER_WIDTH, width - 2 * space.l);
  const left = Math.min(Math.max(tapped.x - 40, space.l), width - popWidth - space.l);
  // Above the word when it clears the status bar, so the finger and the word both stay visible;
  // otherwise below it, and never past the bottom edge.
  const above = tapped.y - POPOVER_GAP - popHeight;
  const top = Math.min(above >= insets.top + space.s ? above : tapped.y + POPOVER_GAP, height - popHeight - insets.bottom - space.s);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View
        onLayout={(e) => setPopHeight(e.nativeEvent.layout.height)}
        style={{
          position: 'absolute', top, left, width: popWidth, opacity: popHeight > 0 ? 1 : 0,
          backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.l,
          padding: space.l, gap: space.xs, ...lift(c, 'high'),
        }}
      >
        <Text style={{ ...type.title, color: c.text }}>{tapped.word.text}</Text>
        <Text style={{ ...type.body, color: c.text }}>{tapped.word.gloss ?? 'No meaning available'}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{wordStatus(tapped.word)}</Text>
        {grammar ? (
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            {grammar.role === 'practice'
              ? `Grammar you're practicing: ${grammar.name}. ${grammar.note}.`
              : `${grammar.name}, which you're avoiding, slipped in here. ${grammar.note}.`}
          </Text>
        ) : null}
        {onToggleFlag ? (
          <View style={{ alignItems: 'flex-start' }}>
            <HeaderAction label={flagged ? 'Unmark' : 'Mark as unknown'} onPress={onToggleFlag} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function PlayerBar({ playing, current, total, what, rate, repeat, silentLine, onToggle, onRate, onRepeat }: {
  playing: boolean;
  current: number | null;
  total: number;
  what: 'dialogue' | 'story';
  rate: number;
  repeat: boolean;
  silentLine: number | null;
  onToggle: () => void;
  onRate: (rate: number) => void;
  onRepeat: () => void;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <Tappable
          onPress={() => { haptic.tap(); onToggle(); }}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          scaleTo={0.92}
          style={{ width: 52, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent }}
        >
          <Icon name={playing ? 'pause.fill' : 'play.fill'} size={22} color={c.onAccent} weight="semibold" />
        </Tappable>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{current === null ? `Play the ${what}` : `Line ${current + 1} of ${total}`}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            {silentLine !== null ? `Line ${silentLine + 1} has no audio.` : repeat ? 'Repeating this line' : "Tap a line's play button to replay it"}
          </Text>
        </View>
        <Tappable
          onPress={() => { haptic.select(); onRepeat(); }}
          accessibilityRole="switch"
          accessibilityLabel="Repeat line"
          accessibilityState={{ checked: repeat }}
          scaleTo={0.95}
          style={{
            minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.m, borderRadius: radius.pill,
            backgroundColor: repeat ? c.accentFill : c.fill,
          }}
        >
          <Text style={{ ...type.footnote, fontWeight: '600', color: repeat ? c.accent : c.textSecondary }}>Repeat line</Text>
        </Tappable>
      </View>
      <Segments options={RATES.map((r) => ({ value: r, label: `${r.toFixed(1)}×`, accessibilityLabel: `Speed ${r}` }))} value={rate} onChange={onRate} />
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.m, padding: space.m }}>
      <Text style={{ ...type.title, color: c.text }}>{value}</Text>
      <Text style={{ ...type.caption, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}
