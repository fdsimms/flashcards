import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Keyboard, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, MAX_STORY_ABOUT_CHARS, type Api, type Language, type PastText, type Shelf, type ShelfText } from '../../reader/api';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import { FLAG_IMAGES } from '../flagImages';
import { SAVED_LABEL, savedState, type SavedState } from '../../reader/downloads';
import { lessonsOffered } from '../../reader/lessons';
import { textSteps } from '../../reader/making';
import { ReadListenAgain } from './ReadListenAgain';
import { ReadReviewFirst } from './ReadReviewFirst';
import { cardDetail, episodeLabel, playOrder, reasonLabel, shelfDetail, upNextOrder, upNextSummary } from '../../reader/shelf';
import { storiesDetail } from '../../reader/stories';
import { haptic } from '../haptics';
import { Button, Card, Divider, ErrorNote, Field, Group, HeaderAction, Help, Icon, NavRow, Screen, SectionTitle, Tappable } from '../kit';
import { MakingBody } from '../MakingCard';
import { PracticeWordPill } from './PracticeWordPill';
import { ReadRecap } from './ReadRecap';
import { GlossPopover, type Tapped } from './Reader';
import { SkeletonList } from '../Skeleton';
import { MIN_TAP, radius, space, type, useTheme, readable } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { useConnectionProblem } from '../connection';
import { prefs } from '../../reader/storage';
import { useDownloads, useSaving } from './readerDownloads';
import { SavedMark } from './SavedMark';

/**
 * Read & Listen's home: one language's shelf (docs/read-and-listen/architecture.md, Shelf). On top,
 * the pinned story's next episode; under it Up next, the texts already written, each saying why
 * it's there, with Play all; then a text to hear again, and the Library (stories, past texts,
 * lessons, marked words). The card shows the story pinned to it; others run in Stories. Nothing is written unasked, so opening a text never waits, since it's
 * written already; the header's + has one written (`onWrite`, a sheet). The language is a menu in
 * the header, and its settings are behind the sliders button.
 *
 * A text is written in the background after it's asked for, so this asks again while something is
 * being written, to show it as it lands.
 */

// While something is being written, check back this often.
const POLL_MS = 10_000;

export type OpenText = { textId: number; order: number[]; playAll?: boolean };

export function ReadShelf({ api, knownLanguage, practice, onPlayWord, onOpen, onPractice, onWrite, onLanguagePage, onPast, onLessons, onStories, onWords, onLanguage, onReview, onListenAgain }: {
  api: Api;
  /** Opened from Review's "Read a text with these words": offers a text written to practice them. */
  /** The language the settings already name, so the header shows it while the shelf loads. */
  knownLanguage?: Language;
  practice?: { language: Language; count: number; onCancel: () => void };
  /** Says a practice word aloud from its popover. */
  onPlayWord: (word: string, language: Language) => void;
  onOpen: (open: OpenText) => void;
  /** Writes a text on `topicId` practicing the words just studied (the reader waits for it). */
  onPractice: (topic: { id: number; name: string }) => void;
  /** Opens having a text written, on a topic or a surprise. */
  onWrite: () => void;
  onLanguagePage: () => void;
  onPast: () => void;
  /** Opens the audio lessons, offered only in the languages the server makes them in. */
  onLessons: () => void;
  /** Opens every story in the language: the one on the card and the others running or ended. */
  onStories: () => void;
  onWords: () => void;
  /** The language was changed here; the app-wide settings follow. */
  onLanguage: () => void;
  /** Opens a deck's review: the language's deck, from the card shown while its reviews are due. */
  onReview: (deck: string) => void;
  /** Plays finished texts again with their words hidden, one after another, from the card offering them. */
  onListenAgain: (texts: PastText[]) => void;
}) {
  const c = useTheme();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Undefined when the count couldn't be read (offline), so the row stops waiting for it.
  const [markedCount, setMarkedCount] = useState<number | null | undefined>(null);
  // Offline the shelf is the texts kept on the phone (reader/offlineApi.ts), and what needs the server is left out.
  const problem = useConnectionProblem();
  const kept = useDownloads();
  const saving = useSaving().texts;
  const markOf = (id: number): SavedState | null => {
    const state = savedState(kept, id, saving);
    // With downloads off, only what's already kept is marked.
    return state === 'saved' || prefs().offlineDownloads !== 'off' ? state : null;
  };
  const [actionError, setActionError] = useState<string | null>(null);
  // The language just picked, shown in the header while its shelf loads.
  const [picked, setPicked] = useState<Language | null>(null);

  const { scrollProps, bottomPadding } = useKeyboardScroll();

  // Bumped when the language changes, so a load started before it is dropped rather than shown.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const started = loadSeq.current;
    try {
      const loaded = await api.shelf();
      if (started !== loadSeq.current) return;
      setShelf(loaded);
      setError(null);
    } catch (e) {
      if (started !== loadSeq.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load your shelf. Pull down to try again.");
    }
    api.markedWords().then((ws) => { if (started === loadSeq.current) setMarkedCount(ws.length); }, () => { if (started === loadSeq.current) setMarkedCount(undefined); });
  }, [api]);
  // Not only on mount: the reader opens on top of this screen, so what was just finished (the story's
  // next episode, the texts left on the shelf) is only known to the server until this asks again.
  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const busy = !!shelf && (shelf.writing.length > 0 || !!shelf.story?.writing);
  useEffect(() => {
    if (!shelf || !busy) return;
    const id = setTimeout(load, POLL_MS);
    return () => clearTimeout(id);
  }, [shelf, busy, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Switches are sent one after another, so the server ends on the language picked last, and only
  // the last one shows its outcome: picking A, then B before A's answer, leaves B on screen.
  const switchSeq = useRef(0);
  const switching = useRef<Promise<unknown>>(Promise.resolve());
  const changeLanguage = async (language: Language) => {
    if (language === shelf?.language) return;
    const mine = ++switchSeq.current;
    loadSeq.current++;
    setPicked(language);
    setShelf(null);
    setError(null);
    setActionError(null);
    const update = switching.current.then(() => api.updateSettings({ language }));
    switching.current = update.catch(() => undefined);
    try {
      await update;
      if (mine === switchSeq.current) onLanguage();
    } catch (e) {
      // Not `error`: the reload below clears that once the shelf (still the old language's) loads.
      if (mine === switchSeq.current) setActionError(e instanceof ApiError ? e.message : "Couldn't switch the language. Try again.");
    }
    if (mine !== switchSeq.current) return;
    await load();
    setPicked(null);
  };

  // Words just studied are in one language: switch to it, once per offer, so the text is written in
  // it. This screen stays mounted as a tab, so the record of the switch is cleared when the offer
  // goes (Not now, or a text started), or the next offer would find the shelf still on the old language.
  const switchedTo = useRef<Language | null>(null);
  useEffect(() => {
    if (!practice) { switchedTo.current = null; return; }
    if (!shelf || switchedTo.current === practice.language) return;
    switchedTo.current = practice.language;
    if (shelf.language !== practice.language) changeLanguage(practice.language);
  }, [practice, shelf]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = shelf ? playOrder(shelf) : [];
  const summary = shelf ? upNextSummary(shelf) : null;
  const open = (textId: number) => onOpen({ textId, order });
  // Up next's texts only: the story's episode is played from its own card.
  const playAll = () => {
    const texts = shelf ? upNextOrder(shelf) : [];
    if (texts.length > 0) onOpen({ textId: texts[0], order: texts, playAll: true });
  };

  const textActions = (text: ShelfText) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: text.title, options: ['Remove from shelf', 'Cancel'], cancelButtonIndex: 1, destructiveButtonIndex: 0 },
      async (i) => {
        setActionError(null);
        try {
          if (i === 0) await api.skip(text.id);
          else return;
          haptic.tap();
        } catch (e) {
          setActionError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
        }
        load();
      },
    );
  };

  const [practiceBusy, setPracticeBusy] = useState(false);
  const startPractice = async () => {
    if (!shelf || practiceBusy) return;
    setPracticeBusy(true);
    setActionError(null);
    try {
      // The idea that best fits the deck.
      const [idea] = await api.suggestions();
      if (!idea) throw new ApiError('There are no topic ideas left. Tap + at the top to write a text on a topic of your own instead.', 0);
      onPractice(await api.addTopic(idea.name));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Couldn't start that text. Try again.");
    } finally {
      setPracticeBusy(false);
    }
  };

  const language = shelf?.language ?? picked ?? knownLanguage;
  const name = language ? LANGUAGES[language].name : 'Read & Listen';

  return (
    <Screen
      title={name}
      largeTitle={false}
      toolbar={(
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Menu icon={language ? FLAG_IMAGES[language] : 'globe'} iconRenderingMode="original" accessibilityLabel={`Language: ${name}. Change the language`}>
              {(shelf?.languages ?? []).map((l) => (
                <Stack.Toolbar.MenuAction
                  key={l.code}
                  isOn={l.code === language}
                  subtitle={l.ready > 0 ? `${l.ready} ready` : undefined}
                  onPress={() => changeLanguage(l.code)}
                >
                  {flaggedName(l.code)}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            {/* Writing needs the server, so offline there's no +. */}
            {problem ? null : <Stack.Toolbar.Button icon="plus" accessibilityLabel={`Write a new ${name} text`} onPress={onWrite} />}
            <Stack.Toolbar.Button icon="slider.horizontal.3" accessibilityLabel={`${name} settings`} onPress={onLanguagePage} />
          </Stack.Toolbar>
        </>
      )}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l + bottomPadding, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {practice ? (
          <Card style={{ gap: space.s }}>
            <Text style={{ ...type.headline, color: c.text }}>{`Practice the ${practice.count} ${practice.count === 1 ? 'word' : 'words'} you just studied`}</Text>
            <Help>A text is written with as many of them as fit. It takes about half a minute.</Help>
            <Button label="Write a text with them" onPress={startPractice} busy={practiceBusy} disabled={!shelf || shelf.language !== practice.language} />
            <View style={{ alignItems: 'flex-start' }}><HeaderAction label="Not now" onPress={practice.onCancel} /></View>
          </Card>
        ) : null}

        {error ? <ErrorNote message={error} onRetry={refresh} /> : null}
        {actionError ? <ErrorNote message={actionError} /> : null}
        {!shelf && !error ? <SkeletonList /> : null}

        {shelf ? (
          <>
            <ReadReviewFirst language={shelf.language} onReview={onReview} />
            <StoryCard api={api} shelf={shelf} saved={shelf.story?.next ? markOf(shelf.story.next.id) : null} onPlayWord={onPlayWord} onOpen={(id) => open(id)} onStarted={refresh} />

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.m, paddingTop: space.s }}>
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" style={{ ...type.title, color: c.text }}>{problem ? 'Downloaded' : 'Up next'}</Text>
                {summary ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{summary}</Text> : null}
              </View>
              {summary ? (
                <Tappable
                  onPress={() => { haptic.tap(); playAll(); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Play all: ${summary}`}
                  style={{ minHeight: MIN_TAP, paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: c.accentFill, flexDirection: 'row', alignItems: 'center', gap: space.s }}
                >
                  <Icon name="play.fill" size={15} color={c.accentInk} />
                  <Text style={{ ...type.body, fontWeight: '600', color: c.accentInk }}>Play all</Text>
                </Tappable>
              ) : null}
            </View>

            {shelf.texts.length > 0 || shelf.writing.length > 0 ? (
              <Group>
                {shelf.texts.map((t, i) => (
                  <ShelfRow key={t.id} text={t} first={i === 0} saved={markOf(t.id)} onPress={() => open(t.id)} onLongPress={problem ? undefined : () => textActions(t)} />
                ))}
                {shelf.writing.map((w, i) => (
                  <View key={`${w.topic}:${i}`} style={{ padding: space.l }}>
                    {shelf.texts.length + i === 0 ? null : <Divider inset={space.l} />}
                    <MakingBody title={w.reason === 'asked' ? w.topic : 'A new text'} steps={textSteps(w.stage)} />
                  </View>
                ))}
              </Group>
            ) : (
              <Help>{problem
                ? `No ${LANGUAGES[shelf.language].name} texts are on this iPhone. They download once you're online, as Settings, Read & Listen says.`
                : "Nothing is written until you ask. Tap + at the top to have a text written, and it appears here when it's ready."}</Help>
            )}

            <ReadListenAgain api={api} onPlay={onListenAgain} />

            <View style={{ gap: space.s }}>
              <SectionTitle>Library</SectionTitle>
              <Group>
                <NavRow first label="Stories" detail={problem ? 'Needs a connection' : storiesDetail(shelf.stories)} disabled={!!problem} onPress={onStories} />
                <NavRow label="Past texts" detail={problem ? 'Needs a connection' : 'Read or listen to a text again'} disabled={!!problem} onPress={onPast} />
                {lessonsOffered(shelf.language) ? <NavRow label="Audio lessons" detail={problem ? lessonsKept(kept.lessons.filter((l) => l.complete && l.lesson.language === shelf.language).length) : 'Guided lessons to say aloud'} onPress={onLessons} /> : null}
                <NavRow label="Marked words" loading={markedCount === null} detail={markedCount == null ? undefined : `${markedCount} marked as unknown`} onPress={onWords} />
              </Group>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const lessonsKept = (n: number) => (n === 1 ? '1 on this iPhone' : `${n} on this iPhone`);

function ShelfRow({ text, first, saved, onPress, onLongPress }: { text: ShelfText; first: boolean; saved: SavedState | null; onPress: () => void; onLongPress?: () => void }) {
  const c = useTheme();
  const reason = reasonLabel(text);
  return (
    <Pressable
      onPress={() => { haptic.tap(); onPress(); }}
      onLongPress={onLongPress ? () => { haptic.select(); onLongPress(); } : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${text.title}. ${shelfDetail(text)}. ${reason}${saved ? `. ${SAVED_LABEL[saved]}` : ''}`}
      accessibilityHint="Opens the text"
      accessibilityActions={onLongPress ? [{ name: 'more', label: 'Remove from shelf' }] : undefined}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'more') onLongPress?.(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : 'transparent' })}
    >
      {first ? null : <Divider inset={space.l + 40 + space.m} />}
      <View style={{ width: 40, height: 40, borderRadius: radius.s + 2, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={text.form === 'dialogue' ? 'bubble.left.and.bubble.right' : 'text.alignleft'} size={18} color={c.textSecondary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, color: c.text }}>{text.title}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>
          {`${shelfDetail(text)} · `}
          <Text style={{ color: text.reason === 'due' ? c.countDue : c.textSecondary }}>{reason}</Text>
        </Text>
      </View>
      {saved ? <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden><SavedMark state={saved} /></View> : null}
      <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
    </Pressable>
  );
}

/** The ongoing story: its next episode, the one being written, or a way to start one. */
function StoryCard({ api, shelf, saved, onPlayWord, onOpen, onStarted }: { api: Api; shelf: Shelf; saved: SavedState | null; onPlayWord: (word: string, language: Language) => void; onOpen: (textId: number) => void; onStarted: () => void }) {
  const c = useTheme();
  const [about, setAbout] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A practice word's or a recap word's popover: its meaning, as on the card's own text.
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const story = shelf.story;

  const start = async () => {
    if (starting) return;
    // A field left focused makes the scroll view scroll to it again whenever the shelf re-renders or the app returns.
    Keyboard.dismiss();
    setStarting(true);
    setError(null);
    try {
      await api.startStory(about.trim());
      setAbout('');
      onStarted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start a story. Try again.");
    } finally {
      setStarting(false);
    }
  };

  if (!story) {
    return (
      <Card>
        <Text style={{ ...type.headline, color: c.text }}>Start an ongoing story</Text>
        <Help>Each episode picks up where the last one ended, with the same people and places, so the same words keep coming back. Leave the topic empty and the story is up to the writer.</Help>
        <Field label="What should it be about?" placeholder="For example, a small café on a rainy day" value={about} onChangeText={setAbout} maxLength={MAX_STORY_ABOUT_CHARS} returnKeyType="done" onSubmitEditing={start} />
        {error ? <ErrorNote message={error} /> : null}
        <Button label="Start a story" variant="secondary" onPress={start} busy={starting} />
      </Card>
    );
  }

  const name = story.title || 'Your story';
  const next = story.next;
  const episode = next ? next.episode : story.read + 1;
  return (
    <Card style={{ borderColor: c.accent, gap: space.m }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: space.s, rowGap: space.xs }}>
        <Text style={{ ...type.overline, color: c.accent }}>{name}</Text>
        <Text style={{ ...type.overline, color: c.textSecondary }}>{episodeLabel(story, episode)}</Text>
      </View>
      {next ? (
        <>
          <Text style={{ ...type.title, color: c.text }}>{next.title}</Text>
          {/* The practice words sit on the length's line, as pills. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>{next.stretch.length > 0 ? `${cardDetail(next)} ·` : cardDetail(next)}</Text>
            {next.stretch.map((w) => {
              // A server older than the practice words sends none, and the pill stays plain.
              const word = next.practice?.find((p) => p.text === w);
              return <PracticeWordPill key={w} word={w} onPress={word ? (x, y) => setTapped({ word, x, y }) : undefined} />;
            })}
            {saved ? <SavedMark state={saved} /> : null}
          </View>
          <Button label="Read and listen" onPress={() => onOpen(next.id)} />
        </>
      ) : story.writing ? (
        <MakingBody title={`Episode ${episode}`} steps={textSteps(story.stage)} />
      ) : story.failed ? (
        <Help>{`Couldn't write the next episode: ${story.failed} The server tries again in half an hour.`}</Help>
      ) : (
        <Help>The next episode is written when you pull down or come back here.</Help>
      )}
      <ReadRecap
        recap={story.last_recap}
        line={story.last_recap_line}
        language={shelf.language}
        tapped={tapped?.word ?? null}
        onTap={(word, x, y) => { haptic.tap(); setTapped({ word, x, y }); }}
      />
      <GlossPopover
        tapped={tapped}
        language={shelf.language}
        translitLabel={LANGUAGES[shelf.language].translitLabel}
        grammar={null}
        api={api}
        grammarChosen={{}}
        onGrammarChosen={() => undefined}
        flagged={false}
        onToggleFlag={null}
        onPlay={() => { if (tapped) onPlayWord(tapped.word.text, shelf.language); }}
        onSelectPhrase={null}
        onAddToDeck={null}
        onClose={() => setTapped(null)}
      />
    </Card>
  );
}
