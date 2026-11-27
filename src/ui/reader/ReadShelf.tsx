import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type TextStage, type Language, type PastText, type Shelf, type ShelfText, type StoryListItem } from '../../reader/api';
import { bannerLine, bannerOverline, pastMeta, readBefore, seasonProgress, storyCoverMeta } from '../../reader/browse';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import { saidAs } from '../../reader/wordAudio';
import { FLAG_IMAGES } from '../flagImages';
import { SAVED_LABEL, savedState, type SavedState } from '../../reader/downloads';
import { ReadInputTime } from './ReadInputTime';
import { ReadListenAgain } from './ReadListenAgain';
import { ReadGrammarRotation } from './ReadGrammarRotation';
import { ReadFromZero } from './ReadFromZero';
import { ReadReviewFirst } from './ReadReviewFirst';
import { cardDetail, playMinutes, playOrder, reasonLabel, upNextOrder, upNextSummary } from '../../reader/shelf';
import { useApp } from '../AppContext';
import { haptic } from '../haptics';
import { Button, ErrorNote, Group, Help, Icon, NavRow, Screen, Tappable } from '../kit';
import { COVER_KIND, COVER_TITLE, Cover, CoverRow, SERIES_TITLE, useCoverTint } from './Cover';
import { PracticeWordRow } from './PracticeWordPill';
import { GlossPopover, type Tapped } from './Reader';
import { MakingSteps } from '../MakingCard';
import { currentStep, textSteps } from '../../reader/making';
import { SkeletonList } from '../Skeleton';
import { radius, smooth, space, type, useTheme, readable, type Colors } from '../theme';
import { useConnectionProblem } from '../connection';
import { prefs } from '../../reader/storage';
import { useDownloads, useSaving } from './readerDownloads';
import { SavedMark } from './SavedMark';
import { pastItem, shelfItem } from '../../reader/audioQueue';
import { useQueueMenu } from '../useQueueMenu';

/**
 * Read & Listen's home: one language's texts as rows of covers, like a streaming app's
 * (docs/read-and-listen/architecture.md, Shelf, Browse). On top, a banner for the story pinned to it
 * with its next episode; then rows that scroll sideways: the other stories, the texts written
 * and not yet read (with Play all), texts to hear again, and texts read before. Nothing is
 * written unasked, so opening a text never waits, since it's written already; the header's + has a
 * series, dialogue or story written (`onNew`, a sheet). The language is a menu in the header, and its
 * settings are behind the gear button.
 *
 * A text is written in the background after it's asked for, so this asks again while something is
 * being written, to show it as it lands.
 */

// While something is being written, check back this often.
const POLL_MS = 10_000;

export type OpenText = { textId: number; order: number[]; playAll?: boolean };

export function ReadShelf({ api, knownLanguage, onPlayWord, onOpen, onGrammarLesson, onNew, onNewSeries, onSettings, onPast, onReadAgain, onStory, onStories, onWords, onLanguage, onReview, onListenAgain, openLanguage, onOpenedLanguage }: {
  api: Api;
  /** The language the settings already name, so the header shows it while the shelf loads. */
  knownLanguage?: Language;
  /** Says a practice word aloud from its popover. */
  onPlayWord: (word: string, language: Language, say?: string) => void;
  onOpen: (open: OpenText) => void;
  /** A grammar point's lesson, from the notice when practiced grammar rotates. */
  onGrammarLesson: (id: string) => void;
  /** Opens having a series, dialogue or story written. */
  onNew: () => void;
  /** Opens having a series written, past the choice of kind. */
  onNewSeries: () => void;
  onSettings: () => void;
  /** Every text read before, from the Reread row's See all. */
  onPast: () => void;
  /** Opens a text read before, to read or listen to again. */
  onReadAgain: (text: PastText) => void;
  /** A story's own page: its episodes, Last time, and pinning or ending it. */
  onStory: (storyId: number) => void;
  /** Every story in the language, running and ended, from the stories row's See all. */
  onStories: () => void;
  onWords: () => void;
  /** The language was changed here; the app-wide settings follow. */
  onLanguage: () => void;
  /** A link's language (franki://read?language=de, from a dundundun task): the shelf switches to it. */
  openLanguage?: string;
  /** The link's language was handled (switched to, or not one the server has), so the route clears it. */
  onOpenedLanguage?: () => void;
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
  // The stories besides the banner's and the texts read before; both need the server, and
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
    // The language this load's shelf is for, once it's known.
    let shelfLanguage: Language | null = null;
    try {
      const loaded = await api.shelf();
      if (started !== loadSeq.current) return;
      shelfLanguage = loaded.language;
      setShelf(loaded);
      setError(null);
    } catch (e) {
      if (started !== loadSeq.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load your texts. Pull down to try again.");
    }
    // The server answers for its language at the moment it's asked, so a request that crossed a
    // language switch comes back for the old one: it's dropped, not shown under the new shelf.
    api.stories().then((r) => { if (started === loadSeq.current && (!shelfLanguage || r.language === shelfLanguage)) setStories(r.stories); }, () => { if (started === loadSeq.current) setStories([]); });
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
    setStories([]);
    setPast([]);
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

  // A link names a language: switch to it once the shelf has loaded, then tell the route, so the
  // same link opened again later (after switching by hand) is handled again. A code the server
  // doesn't list is ignored rather than sent as a settings change it would refuse.
  useEffect(() => {
    if (!openLanguage || !shelf) return;
    const wanted = shelf.languages.find((l) => l.code === openLanguage);
    if (wanted && wanted.code !== shelf.language) changeLanguage(wanted.code);
    onOpenedLanguage?.();
  }, [openLanguage, shelf]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // A text's long-press: Up Next's Play Now, Play Next and Play Later (useQueueMenu), and Remove.
  const queueMenu = useQueueMenu();
  const textActions = (text: ShelfText) => {
    if (!shelf) return;
    // Remove needs the server; Up Next plays a downloaded text offline.
    queueMenu(shelfItem(text, shelf.language), problem ? [] : [{
      label: 'Remove',
      destructive: true,
      onPress: async () => {
        setActionError(null);
        try {
          await api.skip(text.id);
        } catch (e) {
          setActionError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
        }
        load();
      },
    }]);
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
            {problem ? null : <Stack.Toolbar.Button icon="plus" accessibilityLabel={`New ${name} series, dialogue or story`} onPress={onNew} />}
            <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Read & Listen settings" onPress={onSettings} />
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
        {error || actionError || !shelf ? (
          <View style={{ paddingHorizontal: space.l, gap: space.m }}>
            {error ? <ErrorNote message={error} onRetry={refresh} /> : null}
            {actionError ? <ErrorNote message={actionError} /> : null}
            {!shelf && !error ? <SkeletonList /> : null}
          </View>
        ) : null}

        {shelf ? (
          <>
            <View style={{ paddingHorizontal: space.l, gap: space.m }}>
              <ReadGrammarRotation api={api} onOpenLesson={onGrammarLesson} />
              <ReadFromZero language={shelf.language} />
              <ReadReviewFirst language={shelf.language} onReview={onReview} />
            </View>
            <StoryBanner api={api} shelf={shelf} saved={shelf.story?.next ? markOf(shelf.story.next.id) : null} onPlayWord={onPlayWord} onOpen={(id) => open(id)} onStory={onStory} onNew={onNewSeries} offline={!!problem} />

            {others.length > 0 ? (
              <CoverRow title="Your series" action={{ label: 'See all', accessibilityLabel: 'See all series', onPress: onStories }}>
                {others.map((s) => <StoryCover key={s.id} story={s} onPress={() => onStory(s.id)} />)}
              </CoverRow>
            ) : null}

            {shelf.texts.length > 0 || written(shelf).length > 0 ? (
              <CoverRow
                title={problem ? 'Downloaded' : 'Texts'}
                action={summary ? { label: `Play all · ${playMinutes(shelf)} min`, accessibilityLabel: `Play all: ${summary}`, onPress: playAll } : null}
              >
                {shelf.texts.map((t) => <QuickTextCover key={t.id} text={t} saved={markOf(t.id)} onPress={() => open(t.id)} onLongPress={() => textActions(t)} />)}
                {written(shelf).map((w, i) => (
                  <WritingCover key={`${w.topic}:${i}`} title={w.reason === 'asked' ? w.topic : 'A new text'} kind={w.form === 'story' ? 'Story' : 'Dialogue'} stage={w.stage} />
                ))}
              </CoverRow>
            ) : problem ? (
              <View style={{ paddingHorizontal: space.l }}>
                <Help>{`No ${LANGUAGES[shelf.language].name} texts are on this iPhone yet. They download when you're back online (Settings, Read & Listen).`}</Help>
              </View>
            ) : (
              <CoverRow title="Texts">
                <NewCover onPress={onNew} />
              </CoverRow>
            )}

            {(shelf.own?.length ?? 0) > 0 || making(shelf).length > 0 ? (
              <CoverRow title="Your texts">
                {(shelf.own ?? []).map((t) => <QuickTextCover key={t.id} text={t} saved={markOf(t.id)} onPress={() => open(t.id)} onLongPress={() => textActions(t)} />)}
                {making(shelf).map((w, i) => <WritingCover key={`${w.topic}:${i}`} title={w.topic} kind="Your text" stage={w.stage} />)}
              </CoverRow>
            ) : null}

            <ReadListenAgain api={api} onPlay={onListenAgain} />

            {readBeforeTexts.length > 0 ? (
              <CoverRow title="Reread" action={{ label: 'See all', accessibilityLabel: 'See all texts read before', onPress: onPast }}>
                {readBeforeTexts.map((t) => <PastCover key={t.id} text={t} onPress={() => onReadAgain(t)} onLongPress={() => queueMenu(pastItem(t, shelf.language))} />)}
              </CoverRow>
            ) : null}

            <View style={{ paddingHorizontal: space.l }}>
              <Group>
                <NavRow first label="Marked words" loading={markedCount === null} detail={markedCount == null ? undefined : `${markedCount} marked as unknown`} onPress={onWords} />
              </Group>
            </View>

            <View style={{ paddingHorizontal: space.l }}>
              <ReadInputTime api={api} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// How many texts read before the home shows; See all lists the rest.
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

/** The dashed outline of a cover that isn't there yet: one being written, or the way to write one. */
function placeholderCover(c: Colors) {
  return { width: 220, minHeight: 150, padding: space.m + 2, borderRadius: radius.l, ...smooth, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.controlEdge } as const;
}

// Texts being written for the shelf, and pasted texts being translated and recorded (Your texts).
const written = (shelf: Shelf) => shelf.writing.filter((w) => w.reason !== 'own');
const making = (shelf: Shelf) => shelf.writing.filter((w) => w.reason === 'own');

/** A text being written, or a pasted one being translated and recorded: shown where it'll land, and not tappable until it does. */
function WritingCover({ title, kind, stage }: { title: string; kind: string; stage?: TextStage | null }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={`${title}. ${currentStep(textSteps(stage))}.`} style={{ ...placeholderCover(c), justifyContent: 'space-between' }}>
      <View style={{ gap: space.xs + 2 }}>
        <Text style={{ ...COVER_KIND, color: c.textSecondary }}>{kind}</Text>
        <Text style={{ ...COVER_TITLE, color: c.text }}>{title}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <ActivityIndicator size="small" color={c.textSecondary} />
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{currentStep(textSteps(stage))}</Text>
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
      accessibilityLabel="New series, dialogue or story"
      style={{ ...placeholderCover(c), alignItems: 'center', justifyContent: 'center', gap: space.s }}
    >
      <Icon name="plus" size={24} color={c.textSecondary} />
      <Text style={{ ...type.subhead, fontWeight: '600', color: c.textSecondary, textAlign: 'center' }}>{"Tap to write a new text."}</Text>
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
      kind={story.running ? 'Series' : 'Series · Ended'}
      title={story.title || 'Your series'}
      meta={meta.text}
      metaColor={meta.ready ? c.countDue : undefined}
      progress={seasonProgress(story)}
      onPress={onPress}
    />
  );
}

function PastCover({ text, onPress, onLongPress }: { text: PastText; onPress: () => void; onLongPress?: () => void }) {
  const { reader } = useApp();
  return (
    <Cover
      tint={useCoverTint(text.id)}
      width={180}
      kind={text.form === 'story' ? 'Story' : 'Dialogue'}
      title={text.title}
      meta={pastMeta(text, new Date(), reader.dayStartsAtHour)}
      onPress={onPress}
      onLongPress={onLongPress}
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
  onPlayWord: (word: string, language: Language, say?: string) => void;
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
      <View style={{ marginHorizontal: space.l, padding: space.l + 4, borderRadius: radius.xl, ...smooth, backgroundColor: tint, gap: space.m }}>
        <Text style={{ ...type.overline, color: c.accentInk }}>Series</Text>
        <Text style={{ ...SERIES_TITLE, color: c.text }}>Start a series</Text>
        <Help>A story told in episodes. Each one picks up where the last ended, with the same people and places, and is written from the words in your deck.</Help>
        <Button label="Start a series" onPress={onNew} />
      </View>
    );
  }
  const next = story.next;
  return (
    <View style={{ marginHorizontal: space.l, padding: space.l + 4, borderRadius: radius.xl, ...smooth, backgroundColor: tint, gap: space.s }}>
      <Text style={{ ...type.overline, color: c.accentInk }}>{bannerOverline(story)}</Text>
      <Text accessibilityRole="header" style={{ ...SERIES_TITLE, color: c.text }}>{story.title || 'Your series'}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Text style={{ ...type.subhead, color: c.textSecondary, flexShrink: 1 }}>{bannerLine(story)}</Text>
        {saved ? <SavedMark state={saved} /> : null}
      </View>
      {story.writing && !next ? <MakingSteps steps={textSteps(story.stage)} /> : null}
      {next && next.stretch.length > 0 ? (
        <PracticeWordRow words={next.stretch} practice={next.practice} onTap={(word, x, y) => setTapped({ word, x, y })} />
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s, paddingTop: space.s }}>
        {next ? <Button label={`Play episode ${next.episode}`} onPress={() => onOpen(next.id)} style={{ flex: 1 }} /> : null}
        {offline ? null : <Button label={next ? 'Episodes' : 'Open series'} variant="secondary" onPress={() => onStory(story.id)} style={next ? undefined : { flex: 1 }} />}
      </View>
      <GlossPopover
        tapped={tapped}
        language={shelf.language}
        // A word of "Last time" is looked up in the sense of its line.
        meaningLookup={(word) => api.wordMeaning(shelf.language, word.text, story.last_recap_line?.words.includes(word) ? story.last_recap_line.english : undefined)}
        grammar={null}
        api={api}
        grammarChosen={{}}
        onGrammarChosen={() => undefined}
        flagged={false}
        onToggleFlag={null}
        onPlay={() => { if (tapped) onPlayWord(tapped.word.text, shelf.language, saidAs(shelf.language, tapped.word.text, tapped.word.translit)); }}
        onAddToDeck={null}
        onClose={() => setTapped(null)}
      />
    </View>
  );
}
