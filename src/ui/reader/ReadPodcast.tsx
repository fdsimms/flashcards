import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, ScrollView, Text, View } from 'react-native';
import { type Api, ApiError, type GlossLanguage, type PodcastEpisodes, type PodcastPreview, type PodcastShow } from '../../reader/api';
import { flaggedName, glossInfo, TEXT_LANGUAGE_ORDER } from '../../reader/languages';
import { coverageNote, costText, moreNewWords, newWordsTitle, percentKnown } from '../../reader/ownText';
import { canPick, episodeRowDetail, hasNewEpisode, isLink, newestWithTranscript, rememberShow, transcribeAsk, transcriptsLabel, type RememberedShow } from '../../reader/podcasts';
import { loadShows, saveShows } from '../../reader/podcastStorage';
import { prefs } from '../../reader/storage';
import { videoLength } from '../../reader/video';
import type { SharedItem } from '../../core/shareInbox';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Field, Group, Help, Loading, Meter, NavRow, Screen, Select } from '../kit';
import { radius, readable, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';

/** How often a transcription is asked about while Azure works. */
const TRANSCRIBE_POLL_MS = 4000;

type Step =
  | { kind: 'find' }
  | { kind: 'episodes'; listed: PodcastEpisodes }
  | { kind: 'preview'; listed: PodcastEpisodes; guid: string; found: PodcastPreview };

/**
 * A podcast episode to listen to with its transcript (docs/read-and-listen/architecture.md,
 * "Podcasts"; server/reader podcast.py). Find a show in Apple's directory or paste its feed or an
 * Apple Podcasts link (or share one to Franki: `shared`), pick an episode that has a transcript, and
 * see what adding it would give before Add to shelf puts it on the Your texts row, where it opens on
 * Watch. Shows used before are kept on the phone and listed first, with a note when one has a newer
 * episode with a transcript. Off until Settings, Reading and listening, Podcasts turns it on.
 * `toolbar` is New text's Cancel.
 */
export function ReadPodcast({ api, language: readerLanguage, shared, toolbar, onDone }: { api: Api; language: GlossLanguage; shared?: SharedItem; toolbar: React.ReactNode; onDone: () => void }) {
  const c = useTheme();
  const [language, setLanguage] = useState<GlossLanguage>(readerLanguage);
  const [query, setQuery] = useState(shared?.url ?? shared?.text ?? '');
  const [step, setStep] = useState<Step>({ kind: 'find' });
  const [results, setResults] = useState<PodcastShow[] | null>(null);
  const [remembered, setRemembered] = useState<RememberedShow[]>([]);
  const [newer, setNewer] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const name = glossInfo(language).name;
  const on = prefs().podcasts;

  // Shows used before, and which have a newer episode with a transcript than when last used.
  useEffect(() => {
    if (!on) return;
    let live = true;
    void loadShows().then((list) => {
      if (!live) return;
      setRemembered(list);
      for (const show of list) {
        api.podcastEpisodes(show.feed).then((got) => {
          if (live && hasNewEpisode(show, newestWithTranscript(got.episodes))) setNewer((s) => new Set(s).add(show.feed));
        }, () => undefined);
      }
    });
    return () => { live = false; };
  }, [api, on]);

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);

  const openShow = async (link: string) => {
    if (busy) return;
    Keyboard.dismiss();
    setBusy('show');
    setError(null);
    try {
      const listed = await api.podcastEpisodes(link);
      // An Apple Podcasts link to an episode goes straight to its check.
      if (listed.picked) await check(listed, listed.picked);
      else setStep({ kind: 'episodes', listed });
    } catch (e) {
      fail(e, "Couldn't open the podcast. Try again.");
    } finally {
      setBusy(null);
    }
  };

  // A link pasted in the field (or shared) opens its show at once.
  useEffect(() => { if (on && shared && isLink(query)) void openShow(query.trim()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async () => {
    const term = query.trim();
    if (!term || busy) return;
    if (isLink(term)) { await openShow(term); return; }
    Keyboard.dismiss();
    setBusy('search');
    setError(null);
    try {
      setResults((await api.podcastSearch(language, term)).shows);
    } catch (e) {
      fail(e, "Couldn't search for podcasts. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const check = async (listed: PodcastEpisodes, guid: string) => {
    setBusy('check');
    setError(null);
    try {
      const found = await api.podcastPreview(language, listed.show.feed, guid);
      setStep({ kind: 'preview', listed, guid, found });
    } catch (e) {
      setStep({ kind: 'episodes', listed });
      fail(e, "Couldn't check the episode. Try again.");
    } finally {
      setBusy(null);
    }
  };

  // Azure transcribes the episode in the background; the screen asks until it's ready, then checks
  // it as any episode. A screen left meanwhile stops asking (the server carries on).
  const opening = useRef(0);
  useEffect(() => () => { opening.current++; }, []);
  const transcribe = async (listed: PodcastEpisodes, guid: string) => {
    const mine = ++opening.current;
    setBusy('transcribe');
    setError(null);
    try {
      let state = await api.transcribePodcast(language, listed.show.feed, guid);
      while (state.state === 'transcribing') {
        await new Promise((resolve) => setTimeout(resolve, TRANSCRIBE_POLL_MS));
        if (opening.current !== mine) return;
        state = await api.podcastTranscript(listed.show.feed, guid);
      }
      if (opening.current !== mine) return;
      if (state.state !== 'ready') {
        setBusy(null);
        setError(state.error ?? "Couldn't transcribe the episode. Try again.");
        return;
      }
      await check(listed, guid);
    } catch (e) {
      if (opening.current !== mine) return;
      setBusy(null);
      fail(e, "Couldn't transcribe the episode. Try again.");
    }
  };
  const askTranscribe = (listed: PodcastEpisodes, e: PodcastEpisodes['episodes'][number]) => {
    if (busy || e.transcribe_usd == null) return;
    Alert.alert('Transcribe this episode?', transcribeAsk(e), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Transcribe', onPress: () => void transcribe(listed, e.guid) },
    ]);
  };

  const add = async () => {
    if (step.kind !== 'preview' || busy) return;
    setBusy('add');
    setError(null);
    try {
      await api.addPodcast(language, step.listed.show.feed, step.guid);
      const { show, episodes } = step.listed;
      saveShows(rememberShow(remembered, { title: show.title, author: show.author, feed: show.feed, artwork: show.artwork, usedAt: Date.now(), newestGuid: newestWithTranscript(episodes) }));
      haptic.success();
      onDone();
    } catch (e) {
      fail(e, "Couldn't add the episode. Try again.");
      setBusy(null);
    }
  };

  if (!on) {
    return (
      <Screen title="A podcast" largeTitle={false} toolbar={toolbar}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, gap: space.m }}>
          <Help>Listening to podcasts with their transcripts is off. Turn it on in Settings, Reading and listening, Podcasts. Your server then asks Apple's podcast directory and a show's feed when you look for an episode.</Help>
          <Button label="Open Reading and listening" variant="secondary" onPress={() => router.push('/read-listening')} />
        </ScrollView>
      </Screen>
    );
  }

  const footer = step.kind === 'preview'
    ? <Button label="Add to shelf" onPress={add} busy={busy === 'add'} busyLabel="Adding" />
    : step.kind === 'episodes'
      ? <Button label="Back to search" variant="secondary" onPress={() => { setError(null); setStep({ kind: 'find' }); }} />
      : <Button label={isLink(query) ? 'Open' : 'Search'} onPress={search} busy={busy === 'search' || busy === 'show'} busyLabel={isLink(query) ? 'Opening' : 'Searching'} disabled={!query.trim() || busy !== null} />;

  return (
    <Screen title={step.kind === 'find' ? `A ${name} podcast` : step.listed.show.title} largeTitle={false} toolbar={toolbar} footer={footer}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l + bottomPadding, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        {error ? <ErrorNote message={error} /> : null}
        {step.kind === 'find' ? (
          <>
            <Select
              label="Language"
              options={TEXT_LANGUAGE_ORDER.map(flaggedName)}
              value={flaggedName(language)}
              onChange={(v) => { const picked = TEXT_LANGUAGE_ORDER.find((l) => flaggedName(l) === v); if (picked) setLanguage(picked); }}
            />
            <Field
              label="Find a show"
              placeholder="e.g. a show's name, or a link"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={search}
            />
            <Help>{`Search Apple's podcast directory, or paste a show's feed or an Apple Podcasts link. An episode with no transcript of its own can be transcribed by Azure, for its price.`}</Help>
            {remembered.length ? (
              <ShowList title="Used before" shows={remembered.map((s) => ({ ...s, detail: newer.has(s.feed) ? 'New episode with a transcript' : s.author }))} onPick={(feed) => void openShow(feed)} />
            ) : null}
            {results ? (
              results.length
                ? <ShowList title={`Results for "${query.trim()}"`} shows={results.map((s) => ({ ...s, detail: transcriptsLabel(s.transcripts) ?? s.author }))} onPick={(feed) => void openShow(feed)} />
                : <Help>No shows matched. Try another name, or paste the show's feed.</Help>
            ) : null}
          </>
        ) : step.kind === 'episodes' ? (
          busy === 'check' ? <Loading /> : (
            busy === 'transcribe' ? (
              <Card style={{ gap: space.s }}>
                <Text style={{ ...type.overline, color: c.textTertiary }}>Transcribing</Text>
                <Help>About a minute for a half-hour episode. You can leave this screen: it carries on, and the episode shows as transcribed next time.</Help>
                <Loading />
              </Card>
            ) : (
              <Group>
                {step.listed.episodes.map((e, i) => (
                  <NavRow
                    key={e.guid}
                    first={i === 0}
                    label={e.title}
                    detail={episodeRowDetail(e, new Date())}
                    disabled={!canPick(e)}
                    onPress={() => (e.transcript ? void check(step.listed, e.guid) : askTranscribe(step.listed, e))}
                  />
                ))}
              </Group>
            )
          )
        ) : (
          <PodcastPreviewCards preview={step.found} />
        )}
      </ScrollView>
    </Screen>
  );
}

function ShowList({ title, shows, onPick }: { title: string; shows: { feed: string; title: string; detail: string }[]; onPick: (feed: string) => void }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.overline, color: c.textTertiary }}>{title}</Text>
      <Group>
        {shows.map((s, i) => (
          <NavRow
            key={s.feed}
            first={i === 0}
            label={s.title}
            detail={s.detail}
            onPress={() => onPick(s.feed)}
          />
        ))}
      </Group>
    </View>
  );
}

/** What adding it would give: the episode, how much is known, the new words, and the cost. */
function PodcastPreviewCards({ preview }: { preview: PodcastPreview }) {
  const c = useTheme();
  const note = coverageNote(preview);
  const more = moreNewWords(preview);
  return (
    <>
      <Card style={{ gap: space.xs }}>
        <Text style={{ ...type.headline, color: c.text }}>{preview.title}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${preview.show} · ${videoLength(preview.seconds)}`}</Text>
      </Card>
      <Card style={{ gap: space.s }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>Words you know</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }} accessible accessibilityLabel={`${percentKnown(preview)} of the words in it`}>
          <Text style={{ ...type.title, fontSize: 30, color: c.text, fontVariant: ['tabular-nums'] }}>{percentKnown(preview)}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>of the words in it</Text>
        </View>
        <Meter value={preview.coverage} color={c.accent} />
        {note ? <Help>{note}</Help> : null}
      </Card>
      <Card style={{ gap: space.s }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>{newWordsTitle(preview)}</Text>
        {preview.new_words.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 }}>
            {preview.new_words.map((w) => (
              <Text key={w} style={{ ...type.subhead, color: c.text, backgroundColor: c.fill, borderRadius: radius.s, overflow: 'hidden', paddingHorizontal: space.s, paddingVertical: 3 }}>{w}</Text>
            ))}
            {more ? <Text style={{ ...type.subhead, color: c.textSecondary, paddingHorizontal: space.s, paddingVertical: 3 }}>{`+${more}`}</Text> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
          <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>{`${preview.lines} lines, translating`}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{costText(preview.cost_usd)}</Text>
        </View>
      </Card>
    </>
  );
}
