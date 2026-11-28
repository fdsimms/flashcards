import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { cramLanguageOf, themeTopic } from '../../core/cram';
import { canAskMore, factsFromSummary, hasAnswer, linesRequest, missingWords, questionRequest, saidFromText, saidFromTurns, sayChips, SAY_SAID_MAX, SAY_TURN_CHARS, type SayTurn } from '../../core/cramSay';
import { themeWords } from '../../core/cramThemes';
import { failureText } from '../../core/failure';
import type { NoteStore } from '../../anki/noteService';
import type { Api, CramSayLines, Language } from '../../reader/api';
import { loadParticle } from '../../reader/lessonStorage';
import { LANGUAGES } from '../../reader/languages';
import { talkTextStyle } from '../../reader/fonts';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Field, Group, Help, Icon, NavRow, Screen, Tappable } from '../kit';
import { MIN_TAP, radius, readable, smooth, space, type, useTheme } from '../theme';
import { SpeakButton } from '../SpeakButton';
import { saveCram, useCollection, useCrams } from '../useCrams';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { useSpokenAnswer } from '../useSpokenAnswer';
import { usePhoneSpeech } from '../usePhoneSpeech';
import { useWordInDeck } from '../useWordInDeck';
import { Chip } from './CramThemes';
import { setThemeState } from './themeStore';
import { TalkLine } from './TalkLine';
import { useTalkSize } from './talkSize';
import { withThaiLineHeight } from '../../core/script';

type Stage = 'start' | 'ask' | 'write' | 'result';
type AddWords = (language: Language, deck: string, entries: { entry: string; meaning: string }[]) => Promise<'queued' | 'held' | undefined>;

/**
 * Talk it through in English (a cram's page): work out what you want to say at the lesson by saying it
 * in English first. Start offers two ways, Claude asking one question at a time or writing it all at
 * once; both end on what you wanted to say, a line in the language for each thing, built from your own
 * words, with the words you reached for and lack marked, each with a + to send it to Claude through the
 * note queue (saving the note in the editor is the approval). Keeping it saves the summary as the cram's
 * What really happened (`Cram.facts`), which Talking points writes from. Nothing is added to the deck
 * or graded here.
 */
export function CramSay({ repo, api, cramId, decks, add, onTalkingPoints }: {
  repo: NoteStore;
  api: Api;
  cramId: string;
  /** The decks Read & Listen has, to send a word to the one for the cram's language. */
  decks: { deck: string; language: Language }[];
  add: AddWords;
  /** Opens Talking points once What really happened is kept. */
  onTalkingPoints: () => void;
}) {
  const c = useTheme();
  const { crams, loaded: cramsLoaded } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === cramId);
  const topic = cram ? themeTopic(cram) : '';
  const language = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  const words = useMemo(
    () => (collection.loaded && language ? themeWords({ notes: collection.notes, cards: collection.cards, language, crams, now: new Date(), cram }) : []),
    [collection.loaded, collection.notes, collection.cards, language, crams],
  );
  const [stage, setStage] = useState<Stage>('start');
  const [turns, setTurns] = useState<SayTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState<'question' | 'lines'>();
  const [problem, setProblem] = useState<{ message: string; retry: () => void }>();
  const [result, setResult] = useState<CramSayLines>();
  const [saving, setSaving] = useState(false);
  const [kept, setKept] = useState(false);
  // What the draft held when listening began: what's heard is added after it.
  const before = useRef('');
  const spoken = useSpokenAnswer(LANGUAGES.en.speech, {
    onBeforeListen: () => { before.current = draft.trim(); },
    onHeard: (text) => setDraft([before.current, text].filter(Boolean).join(' ').slice(0, stage === 'write' ? SAY_SAID_MAX : SAY_TURN_CHARS)),
  });

  const ready = !!cram && !!language && cramsLoaded && collection.loaded;
  const stuck = cram && collection.loaded && !language ? "Choose the cram's language first (Edit, on its page)." : undefined;

  const fail = (what: string, retry: () => void) => (e: unknown) => setProblem({ message: failureText(e, { what, next: 'Try again.' }), retry });

  const askQuestion = useCallback(async (from: SayTurn[]) => {
    if (!language || working) return;
    setWorking('question');
    setProblem(undefined);
    try {
      const question = await api.cramSayAsk(questionRequest(language, topic, from));
      setTurns([...from, { asker: 'claude', text: question }]);
    } catch (e) {
      fail("Couldn't get a question.", () => { void askQuestion(from); })(e);
    } finally {
      setWorking(undefined);
    }
  }, [api, language, topic, working]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAsk = () => {
    haptic.tap();
    setStage('ask');
    if (!turns.length) void askQuestion([]);
  };
  const startWrite = () => { haptic.tap(); setStage('write'); };

  const send = () => {
    const text = draft.replace(/\s+/g, ' ').trim();
    if (!text || working) return;
    haptic.tap();
    spoken.stop();
    const next: SayTurn[] = [...turns, { asker: 'you', text }];
    setTurns(next);
    setDraft('');
    if (canAskMore(next)) void askQuestion(next);
  };

  const findLines = useCallback(async (said: string) => {
    if (!language || working || !said) return;
    haptic.tap();
    spoken.stop();
    setWorking('lines');
    setProblem(undefined);
    try {
      const particle = await loadParticle();
      const answer = await api.cramSayLines(linesRequest(language, topic, said, words, cram?.register, particle));
      setResult(answer);
      setKept(false);
      setStage('result');
    } catch (e) {
      fail("Couldn't find what you'd want to say.", () => { void findLines(said); })(e);
    } finally {
      setWorking(undefined);
    }
  }, [api, language, topic, words, cram?.register, working]); // eslint-disable-line react-hooks/exhaustive-deps

  const keep = async (thenTalkingPoints: boolean) => {
    if (!cram || !result || saving) return;
    haptic.tap();
    setSaving(true);
    setProblem(undefined);
    try {
      await saveCram(repo, { ...cram, facts: factsFromSummary(result.summary) || undefined });
      setKept(true);
      if (thenTalkingPoints) {
        // Talking points asks again from What really happened, not from the ideas it showed before.
        setThemeState({ suggested: undefined });
        onTalkingPoints();
      }
    } catch (e) {
      fail("Couldn't save what happened.", () => { void keep(thenTalkingPoints); })(e);
    } finally {
      setSaving(false);
    }
  };

  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const footer = ((): React.ReactNode => {
    if (stage === 'ask' && hasAnswer(turns)) {
      return <Button label="Find what I'd want to say" busy={working === 'lines'} busyLabel="Finding what you'd say" onPress={() => { void findLines(saidFromTurns(turns)); }} variant={canAskMore(turns) || working === 'question' ? 'secondary' : 'primary'} />;
    }
    if (stage === 'write') {
      return <Button label="Find what I'd need to say" busy={working === 'lines'} busyLabel="Finding what you'd say" disabled={!saidFromText(draft)} onPress={() => { void findLines(saidFromText(draft)); }} />;
    }
    if (stage === 'result') {
      return <Button label="Write talking points from this" busy={saving} onPress={() => { void keep(true); }} />;
    }
    return undefined;
  })();

  return (
    <Screen title="Talk it through" largeTitle={false} footer={footer}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ ...readable, padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} {...scrollProps}>
        {stuck ? <Help>{stuck}</Help> : null}
        {ready && stage === 'start' ? (
          <>
            <Help>{topic ? `Say what happened, or what you'd want to say, about "${topic}" in English. Nothing here is graded or saved as cards.` : "Say what happened, or what you'd want to say, in English. Nothing here is graded or saved as cards."}</Help>
            <Group>
              <NavRow first icon={{ name: 'bubble.left.and.bubble.right', color: c.accent }} label="Claude asks, you answer" detail="A few questions, one at a time." onPress={startAsk} />
              <NavRow icon={{ name: 'square.and.pencil', color: c.accent }} label="Write it all at once" detail="Tell it the way you'd tell a friend." onPress={startWrite} />
            </Group>
          </>
        ) : null}
        {ready && stage === 'ask' ? <Chat turns={turns} draft={draft} onDraft={setDraft} onSend={send} asking={working === 'question'} spoken={spoken} /> : null}
        {ready && stage === 'write' ? (
          <Card>
            <Field label="What happened, or what you'd want to say" value={draft} onChangeText={(t) => setDraft(t.slice(0, SAY_SAID_MAX))} placeholder="e.g. Ran the 5k today in 27 minutes. The hill at the end was steep." multiline style={{ minHeight: 140 }} />
            <View style={{ alignItems: 'flex-end' }}><SpeakButton spoken={spoken} label="Dictate" size="small" /></View>
            <Help>Rough is fine. Claude finds what you'd need to say from it.</Help>
          </Card>
        ) : null}
        {ready && stage === 'result' && result && language ? (
          <Result repo={repo} result={result} language={language} deck={decks.find((d) => d.language === language)?.deck} add={add} kept={kept} saving={saving} onKeep={() => { void keep(false); }} />
        ) : null}
        {problem ? <ErrorNote message={problem.message} onRetry={problem.retry} /> : null}
      </ScrollView>
    </Screen>
  );
}

/** The chat: Claude's questions on the left, your answers on the right, then a box for the next answer. */
function Chat({ turns, draft, onDraft, onSend, asking, spoken }: {
  turns: SayTurn[];
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  asking: boolean;
  spoken: ReturnType<typeof useSpokenAnswer>;
}) {
  const c = useTheme();
  const waiting = turns[turns.length - 1]?.asker === 'you' && !asking && !canAskMore(turns);
  const ready = turns[turns.length - 1]?.asker === 'claude';
  return (
    <>
      <Help>Answer in English, as loosely as you like.</Help>
      <View style={{ gap: space.s }}>
        {turns.map((t, i) => (
          <View key={i} style={{ maxWidth: '85%', alignSelf: t.asker === 'claude' ? 'flex-start' : 'flex-end', borderRadius: radius.l, ...smooth, paddingVertical: space.s + 1, paddingHorizontal: space.m, backgroundColor: t.asker === 'claude' ? c.surface : c.accentFill, borderWidth: t.asker === 'claude' ? 1 : 0, borderColor: c.border }}>
            <Text style={{ ...withThaiLineHeight(type.callout, t.text), color: c.text }}>{t.text}</Text>
          </View>
        ))}
        {asking ? <Text style={{ ...type.subhead, color: c.textSecondary }}>Thinking of a question</Text> : null}
      </View>
      {ready ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.s }}>
          <View style={{ flex: 1 }}>
            <Field label="Your answer" value={draft} onChangeText={(t) => onDraft(t.slice(0, SAY_TURN_CHARS))} placeholder="Answer" multiline onSubmitEditing={onSend} />
          </View>
          <SpeakButton spoken={spoken} label="Dictate" size="small" />
          <Tappable
            onPress={onSend}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            restOpacity={draft.trim() ? 1 : 0.45}
            style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="arrow.up" size={18} color={c.onAccent} weight="bold" />
          </Tappable>
        </View>
      ) : null}
      {waiting ? <Help>That's all the questions. Find what you'd want to say below.</Help> : null}
    </>
  );
}

/** What you wanted to say: each thing in English, the line in the language (tap to hear it, a dotted word to see its meaning), how many of its words you know, and the words you lack with a +. */
function Result({ repo, result, language, deck, add, kept, saving, onKeep }: {
  repo: Parameters<typeof usePhoneSpeech>[0];
  result: CramSayLines;
  language: Language;
  deck: string | undefined;
  add: AddWords;
  kept: boolean;
  saving: boolean;
  onKeep: () => void;
}) {
  const c = useTheme();
  const phone = usePhoneSpeech(repo);
  const [size] = useTalkSize();
  const info = LANGUAGES[language];
  const [added, setAdded] = useState<Set<string>>(new Set());
  const inDeck = useWordInDeck(repo);
  const [busy, setBusy] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const lacking = useMemo(() => missingWords(result.lines), [result]);
  const say = (text: string) => phone.sayLine(text, info.speech, false);
  const addWord = async (word: string, meaning: string) => {
    if (busy || !deck) return;
    haptic.tap();
    setBusy(word);
    setProblem(undefined);
    try {
      await add(language, deck, [{ entry: word, meaning }]);
      setAdded((prev) => new Set(prev).add(word));
    } catch (e) {
      setProblem(failureText(e, { what: `Couldn't add ${word}.`, next: 'Try again.' }));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <>
      <Help>From what you said, in the {info.name} you already know. A dotted word is one you haven't studied yet.</Help>
      <Card style={{ gap: space.m }}>
        {result.lines.map((line, i) => {
          const chips = sayChips(line);
          return (
            <View key={`${i}-${line.text}`} style={{ gap: space.xs, borderTopWidth: i ? 1 : 0, borderTopColor: c.border, paddingTop: i ? space.m : 0 }}>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>{line.english}</Text>
              <TalkLine text={line.text} language={language} size={size} unknown={line.missing} onSay={say} />
              {chips.known || chips.missing ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {chips.known ? <Chip label={chips.known} ink={c.accentInk} fill={c.accentFill} /> : null}
                  {chips.missing ? <Chip label={chips.missing} ink={c.warningInk} fill={c.warningFill} /> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
      {lacking.length ? (
        <Card>
          <Text style={{ ...type.footnote, color: c.textSecondary, fontWeight: '600' }}>{`WORDS YOU REACHED FOR · ${lacking.length}`}</Text>
          {lacking.map((w) => {
            const done = added.has(w.word);
            // Already in the deck (a new card not studied yet): nothing to send to Claude.
            const have = !done && inDeck(deck, w.word);
            return (
              <Tappable
                key={w.word}
                onPress={() => { void addWord(w.word, w.english); }}
                disabled={done || have || !deck || !!busy}
                accessibilityRole="button"
                accessibilityLabel={done ? `${w.word} added` : have ? `${w.word}, already in your deck` : `Add ${w.word}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP }}
              >
                <Text style={{ ...talkTextStyle(info, size, 0.75), color: c.text }}>{w.word}</Text>
                <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{w.english}</Text>
                {have ? <Text style={{ ...type.footnote, color: c.textSecondary }}>In your deck</Text> : (
                  <Icon name={done ? 'checkmark.circle.fill' : 'plus.circle'} size={24} color={done ? c.goodInk : deck ? c.accentInk : c.textTertiary} />
                )}
              </Tappable>
            );
          })}
          <Help>Claude fills in each word you add. Save each one in the note editor.</Help>
          {problem ? <ErrorNote message={problem} /> : null}
        </Card>
      ) : null}
      <Button variant="secondary" label={kept ? 'Saved for Talking points' : 'Use this for Talking points'} disabled={kept || saving || !result.summary.trim()} onPress={onKeep} />
      {result.summary.trim() ? <Help>{kept ? 'Talking points on this cram are written from it. You can edit it there.' : `Talking points will only use what you said here: "${factsFromSummary(result.summary)}"`}</Help> : null}
    </>
  );
}
