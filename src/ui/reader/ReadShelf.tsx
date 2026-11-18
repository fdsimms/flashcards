import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type Form, type Language, type PastText, type Shelf, type ShelfText, type StoryListItem } from '../../reader/api';
import { bannerLine, bannerOverline, pastMeta, readBefore, seasonProgress, storyCoverMeta } from '../../reader/browse';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import { FLAG_IMAGES } from '../flagImages';
import { SAVED_LABEL, savedState, type SavedState } from '../../reader/downloads';
import { ReadListenAgain } from './ReadListenAgain';
import { ReadReviewFirst } from './ReadReviewFirst';
import { cardDetail, playMinutes, playOrder, reasonLabel, upNextOrder, upNextSummary } from '../../reader/shelf';
import { useApp } from '../AppContext';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Group, HeaderAction, Help, Icon, NavRow, Screen, Tappable } from '../kit';
import { Cover, CoverRow, useCoverTint } from './Cover';
import { PracticeWordPill } from './PracticeWordPill';
import { GlossPopover, type Tapped } from './Reader';
import { SkeletonList } from '../Skeleton';
import { radius, smooth, space, type, useTheme, readable } from '../theme';
import { useConnectionProblem } from '../connection';
import { prefs } from '../../reader/storage';
import { useDownloads, useSaving } from './readerDownloads';
import { SavedMark } from './SavedMark';

/**
 * Read & Listen's home: one language's texts as rows of covers, like a streaming app's
 * (docs/read-and-listen/architecture.md, Shelf, Browse). On top, a banner for the story pinned to it
 * with its next episode; then rows that scroll sideways: the other stories, the quick texts written
 * and not yet read (with Play all), texts to hear again, and quick texts read before. Nothing is
 * written unasked, so opening a text never waits, since it's written already; the header's + has a
 * story or a quick text written (`onNew`, a sheet). The language is a menu in the header, and its
 * settings are behind the sliders button.
 *
 * A text is written in the background after it's asked for, so this asks again while something is
 * being written, to show it as it lands.
 */

// While something is being written, check back this often.
const POLL_MS = 10_000;

export type OpenText = { textId: number; order: number[]; playAll?: boolean };

export function ReadShelf({ api, knownLanguage, practice, onPlayWord, onOpen, onPractice, onNew, onLanguagePage, onPast, onReadAgain, onStory, onStories, onWords, onLanguage, onReview, onListenAgain }: {
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
  /** Opens having a story or a quick text written. */
  onNew: () => void;
  onLanguagePage: () => void;
  /** Every text read before, from the Read before row's See all. */
  onPast: () => void;
  /** Opens a quick text read before, to read or listen to again. */
  onReadAgain: (text: PastText) => void;
  /** A story's own page: its episodes, Last time, and pinning or ending it. */
  onStory: (storyId: number) => void;
  /** Every story in the language, running and ended, from the stories row's See all. */
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
  // The stories besides the banner's and the quick texts read before; both need the server, and
  // are left empty when it can't be reached.
  const [stories, setStories] = useState<StoryListItem[]>([]);
  const [past, setPast] = useState<PastText[]>([]);
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
      setError(e instanceof ApiError ? e.message : "Couldn't load your texts. Pull down to try again.");
    }
    api.stories().then((r) => { if (started === loadSeq.current) setStories(r.stories); }, () => { if (started === loadSeq.current) setStories([]); });
    api.pastTexts().then((r) => { if (started === loadSeq.current) setPast(r); }, () => { if (started === loadSeq.current) setPast([]); });
    api.markedWords().then((ws) => { if (started === loadSeq.current) setMarkedCount(ws.length); }, () => { if (started === loadSeq.current) setMarkedCount(undefined); });
  }, [api]);
  // Not only on mount: the reader opens on top of this screen, so what was just finished (the story's
  // next episode, the texts left on the shelf) is only known to the server until this asks again.
  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const busy = !!shelf && (shelf.writing.length > 0 || !!shelf.story?.writing || stories.some((s) => s.writing));
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
  const others = stories.filter((s) => s.id !== shelf?.story?.id);
  const readBeforeTexts = readBefore(past, READ_BEFORE);
  const open = (textId: number) => onOpen({ textId, order });
  // Up next's texts only: the story's episode is played from its own card.
  const playAll = () => {
    const texts = shelf ? upNextOrder(shelf) : [];
    if (texts.length > 0) onOpen({ textId: texts[0], order: texts, playAll: true });
  };

  const textActions = (text: ShelfText) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: text.title, options: ['Remove', 'Cancel'], cancelButtonIndex: 1, destructiveButtonIndex: 0 },
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
            {problem ? null : <Stack.Toolbar.Button icon="plus" accessibilityLabel={`New ${name} story or quick text`} onPress={onNew} />}
            <Stack.Toolbar.Button icon="slider.horizontal.3" accessibilityLabel={`${name} settings`} onPress={onLanguagePage} />
          </Stack.Toolbar>
        </>
      )}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        // The rows of covers run to the screen's edges, so the gutter is on everything else instead.
        contentContainerStyle={{ ...readable, paddingTop: space.m, paddingBottom: space.xl, gap: space.l }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {practice ? (
          <Card style={{ gap: space.s, marginHorizontal: space.l }}>
            <Text style={{ ...type.headline, color: c.text }}>{`Practice the ${practice.count} ${practice.count === 1 ? 'word' : 'words'} you just studied`}</Text>
            <Help>A text is written with as many of them as fit. It takes about half a minute.</Help>
            <Button label="Write a text with them" onPress={startPractice} busy={practiceBusy} disabled={!shelf || shelf.language !== practice.language} />
            <View style={{ alignItems: 'flex-start' }}><HeaderAction label="Not now" onPress={practice.onCancel} /></View>
          </Card>
        ) : null}

        {error || actionError || !shelf ? (
          <View style={{ paddingHorizontal: space.l, gap: space.m }}>
            {error ? <ErrorNote message={error} onRetry={refresh} /> : null}
            {actionError ? <ErrorNote message={actionError} /> : null}
            {!shelf && !error ? <SkeletonList /> : null}
          </View>
        ) : null}

        {shelf ? (
          <>
            <View style={{ paddingHorizontal: space.l }}>
              <ReadReviewFirst language={shelf.language} onReview={onReview} />
            </View>
            <StoryBanner api={api} shelf={shelf} saved={shelf.story?.next ? markOf(shelf.story.next.id) : null} onPlayWord={onPlayWord} onOpen={(id) => open(id)} onStory={onStory} onNew={onNew} offline={!!problem} />

            {others.length > 0 ? (
              <CoverRow title="Your stories" action={{ label: 'See all', accessibilityLabel: 'See all stories', onPress: onStories }}>
                {others.map((s) => <StoryCover key={s.id} story={s} onPress={() => onStory(s.id)} />)}
              </CoverRow>
            ) : null}

            {shelf.texts.length > 0 || shelf.writing.length > 0 ? (
              <CoverRow
                title={problem ? 'Downloaded' : 'Quick texts'}
                action={summary ? { label: `Play all · ${playMinutes(shelf)} min`, accessibilityLabel: `Play all: ${summary}`, onPress: playAll } : null}
              >
                {shelf.texts.map((t) => <QuickTextCover key={t.id} text={t} saved={markOf(t.id)} onPress={() => open(t.id)} onLongPress={problem ? undefined : () => textActions(t)} />)}
                {shelf.writing.map((w, i) => (
                  <WritingCover key={`${w.topic}:${i}`} title={w.reason === 'asked' ? w.topic : 'A new quick text'} form={w.form} />
                ))}
              </CoverRow>
            ) : problem ? (
              <View style={{ paddingHorizontal: space.l }}>
                <Help>{`No ${LANGUAGES[shelf.language].name} texts are on this iPhone. They download once you're online, as Settings, Read & Listen says.`}</Help>
              </View>
            ) : (
              <CoverRow title="Quick texts">
                <NewCover onPress={onNew} />
              </CoverRow>
            )}

            <ReadListenAgain api={api} onPlay={onListenAgain} />

            {readBeforeTexts.length > 0 ? (
              <CoverRow title="Read before" action={{ label: 'See all', accessibilityLabel: 'See all texts read before', onPress: onPast }}>
                {readBeforeTexts.map((t) => <PastCover key={t.id} text={t} onPress={() => onReadAgain(t)} />)}
              </CoverRow>
            ) : null}

            <View style={{ paddingHorizontal: space.l }}>
              <Group>
                <NavRow first label="Marked words" loading={markedCount === null} detail={markedCount == null ? undefined : `${markedCount} marked as unknown`} onPress={onWords} />
              </Group>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// How many quick texts read before the home shows; See all lists the rest.
const READ_BEFORE = 10;

function QuickTextCover({ text, saved, onPress, onLongPress }: { text: ShelfText; saved: SavedState | null; onPress: () => void; onLongPress?: () => void }) {
  const c = useTheme();
  const reason = reasonLabel(text);
  return (
    <Cover
      tint={useCoverTint(text.id)}
      kind={cardDetail(text)}
      title={text.title}
      subtitle={text.title_english}
      meta={reason}
      metaColor={text.reason === 'due' ? c.countDue : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={`${text.title}. ${text.title_english ? `${text.title_english}. ` : ''}${cardDetail(text)}. ${reason}${saved ? `. ${SAVED_LABEL[saved]}` : ''}`}
      corner={saved ? <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden><SavedMark state={saved} /></View> : null}
    />
  );
}

/** A quick text being written: shown where it'll land, and not tappable until it does. */
function WritingCover({ title, form }: { title: string; form: Form }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={`${title}. Being written.`} style={{ width: 220, minHeight: 150, padding: space.m + 2, borderRadius: radius.l, ...smooth, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.controlEdge, justifyContent: 'space-between' }}>
      <View style={{ gap: space.xs + 2 }}>
        <Text style={{ ...type.overline, fontSize: 11, color: c.textSecondary }}>{form === 'story' ? 'Story' : 'Dialogue'}</Text>
        <Text style={{ fontSize: 19, fontWeight: '800', lineHeight: 22, color: c.text }}>{title}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <ActivityIndicator size="small" color={c.textSecondary} />
        <Text style={{ ...type.footnote, color: c.textSecondary }}>Being written</Text>
      </View>
    </View>
  );
}

/** With nothing on the shelf: the way to have a text written, where the covers would be. */
function NewCover({ onPress }: { onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel="New story or quick text. Nothing is written until you ask."
      style={{ width: 220, minHeight: 150, padding: space.m + 2, borderRadius: radius.l, ...smooth, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.controlEdge, alignItems: 'center', justifyContent: 'center', gap: space.s }}
    >
      <Icon name="plus" size={24} color={c.textSecondary} />
      <Text style={{ ...type.subhead, fontWeight: '600', color: c.textSecondary, textAlign: 'center' }}>{"Nothing is written until you ask. Tap to have one written."}</Text>
    </Tappable>
  );
}

function StoryCover({ story, onPress }: { story: StoryListItem; onPress: () => void }) {
  const c = useTheme();
  const meta = storyCoverMeta(story);
  return (
    <Cover
      tint={useCoverTint(`story:${story.id}`)}
      width={150}
      kind={story.running ? 'Story' : 'Story · Ended'}
      title={story.title || 'Your story'}
      meta={meta.text}
      metaColor={meta.ready ? c.countDue : undefined}
      progress={seasonProgress(story)}
      onPress={onPress}
    />
  );
}

function PastCover({ text, onPress }: { text: PastText; onPress: () => void }) {
  const { reader } = useApp();
  return (
    <Cover
      tint={useCoverTint(text.id)}
      width={180}
      kind={text.form === 'story' ? 'Story' : 'Dialogue'}
      title={text.title}
      meta={pastMeta(text, new Date(), reader.dayStartsAtHour)}
      onPress={onPress}
    />
  );
}

/**
 * The pinned story as a banner: its next episode to play, its practice words (tap one for its
 * meaning), and its page. With no story running, a way to start one.
 */
function StoryBanner({ api, shelf, saved, onPlayWord, onOpen, onStory, onNew, offline }: {
  api: Api;
  shelf: Shelf;
  saved: SavedState | null;
  onPlayWord: (word: string, language: Language) => void;
  onOpen: (textId: number) => void;
  onStory: (storyId: number) => void;
  onNew: () => void;
  offline: boolean;
}) {
  const c = useTheme();
  // A practice word's popover: its meaning, as in the reader.
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const story = shelf.story;
  const tint = useCoverTint(`story:${story?.id ?? 0}`);
  if (!story) {
    if (offline) return null;
    return (
      <View style={{ marginHorizontal: space.l, padding: space.l, borderRadius: radius.xl, ...smooth, backgroundColor: tint, gap: space.m }}>
        <Text style={{ ...type.overline, color: c.accentInk }}>Story</Text>
        <Text style={{ fontSize: 28, fontWeight: '800', color: c.text }}>Start a story</Text>
        <Help>Each episode picks up where the last one ended, with the same people and places, so the same words keep coming back.</Help>
        <Button label="Start a story" onPress={onNew} />
      </View>
    );
  }
  const next = story.next;
  return (
    <View style={{ marginHorizontal: space.l, padding: space.l + 4, borderRadius: radius.xl, ...smooth, backgroundColor: tint, gap: space.s }}>
      <Text style={{ ...type.overline, color: c.accentInk }}>{bannerOverline(story)}</Text>
      <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: '800', lineHeight: 34, color: c.text }}>{story.title || 'Your story'}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Text style={{ ...type.subhead, color: c.textSecondary, flexShrink: 1 }}>{bannerLine(story)}</Text>
        {saved ? <SavedMark state={saved} /> : null}
      </View>
      {next && next.stretch.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingTop: space.xs }}>
          {next.stretch.map((w) => {
            // A server older than the practice words sends none, and the pill stays plain.
            const word = next.practice?.find((p) => p.text === w);
            return <PracticeWordPill key={w} word={w} onPress={word ? (x, y) => setTapped({ word, x, y }) : undefined} />;
          })}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s, paddingTop: space.s }}>
        {next ? <Button label={`Play episode ${next.episode}`} onPress={() => onOpen(next.id)} style={{ flex: 1 }} /> : null}
        {offline ? null : <Button label={next ? 'Episodes' : 'Open story'} variant="secondary" onPress={() => onStory(story.id)} style={next ? undefined : { flex: 1 }} />}
      </View>
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
    </View>
  );
}
