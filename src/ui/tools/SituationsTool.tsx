import { useAudioPlayer } from 'expo-audio';
import { Stack } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, TextInput, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { failureText } from '../../core/failure';
import type { Language, SituationFeedback, SituationFocus, SituationTurn } from '../../reader/api';
import { readFont, scaledFontSize } from '../../reader/fonts';
import { LANGUAGES } from '../../reader/languages';
import { useApp } from '../AppContext';
import { useKeyboardLanguage } from '../useKeyboardLanguage';
import type { RegisterLevel } from '../../reader/registerLevel';
import { canFinish, canSend, conversationOf, rehearsalOf, startChat, withMine, withoutMine, withTheirs, type Chat, type Partner } from '../../reader/situations';
import { keep, keepable } from '../../reader/corrections';
import { loadKept, saveKept } from '../../reader/correctionsStorage';
import { isSlow, NORMAL_RATE, SLOW_RATE } from '../../reader/playbackRate';
import { speedFor } from '../../reader/prefs';
import { loadParticle } from '../../reader/lessonStorage';
import { prefs } from '../../reader/storage';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Group, Help, Icon, Loading, NavRow, Screen, Tappable } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme, readable } from '../theme';
import { useTrackedPlayer } from '../useSoundingButton';
import { useHeaderInset } from '../useHeaderInset';
import { useKeyboardScroll } from '../useKeyboardScroll';
import type { ToolScreenProps } from './index';
import { MyLine, SituationResult, TheirLine } from './SituationParts';
import { HoldToTalk, ListeningNote } from '../SpeakButton';
import { usePhoneSpeech } from '../usePhoneSpeech';
import { useSpokenAnswer } from '../useSpokenAnswer';
import { PracticeCard } from './PracticeCard';
import { SituationKeep, type KeepState } from './SituationKeep';
import { SituationRehearse } from './SituationRehearse';
import { ToolScreen, useToolLanguage } from './ToolScreen';
import { CardSurface } from '../SwipeCard';
import { MissingKeyboardNote } from '../useMissingKeyboard';

/**
 * Situations (server/reader situations.py), as Review's card (PracticeCard.tsx): a scene on a card, Another for the next
 * and Start (or type one of your own), then the conversation is the card, with Hold to talk or a field under it, and
 * How it went is a card with a ring for the lines right. Pick a scene or type one, then talk it through with Claude,
 * who plays the other person from the deck's words, each of their lines spoken by the phone's voice (or
 * by an Azure voice, a setting in Read & Listen's). Finish
 * asks for feedback on each of the owner's lines and words worth adding. The conversation lives here and
 * goes to the server with each turn; nothing is kept, and nothing grades a card or writes a note (Add
 * only puts a word in the note queue, for the note editor).
 */
export function SituationsTool({ tool, repo, readerApi, params, onClose }: ToolScreenProps) {
  const [language, setLanguage] = useToolLanguage(tool);
  const [chat, setChat] = useState<Chat | null>(null);
  const [heardOnly, setHeardOnly] = useState(false);
  const [feedback, setFeedback] = useState<SituationFeedback | null>(null);
  // Opened from a grammar topic's page (Your topics): the scene practices that topic.
  const focus = focusOf(params.focus);
  // Opened from a cram or a theme (Rehearse): its title is the scene and its words are worked in, until another scene is picked.
  const rehearsal = rehearsalOf(params);
  const [other, setOther] = useState(false);
  // The rehearsed cram's register to begin with; changing it here is for this scene only.
  const [sceneRegister, setSceneRegister] = useState<RegisterLevel | undefined>(rehearsal?.register);
  const [partner, setPartner] = useState<Partner>(rehearsal?.partner ?? 'scene');
  const settingsRegister = useApp().reader.settings?.register;

  if (!readerApi) {
    return (
      <Screen title={tool.title} largeTitle={false}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}>
          <Card><Help>Situations uses Read & Listen. Turn it on in Settings, Read & Listen.</Help></Card>
        </ScrollView>
      </Screen>
    );
  }
  if (!chat && rehearsal && !other) {
    return (
      <SituationRehearse
        title={tool.title}
        rehearsal={rehearsal}
        register={sceneRegister}
        settingsRegister={settingsRegister}
        onRegister={setSceneRegister}
        partner={partner}
        onPartner={setPartner}
        onStart={() => { setFeedback(null); setChat(startChat(rehearsal.language, rehearsal.scene, focus, rehearsal.words, sceneRegister, partner, rehearsal.prepared)); }}
        onPickOther={() => setOther(true)}
      />
    );
  }
  if (!chat) {
    return (
      <PickScene
        tool={tool}
        api={readerApi}
        language={language}
        onLanguage={setLanguage}
        heardOnly={heardOnly}
        onHeardOnly={setHeardOnly}
        focus={focus}
        onStart={(scene) => { setFeedback(null); setChat(startChat(language, scene, focus)); }}
      />
    );
  }
  return (
    <Talk
      api={readerApi}
      repo={repo}
      chat={chat}
      onChat={setChat}
      heardOnly={heardOnly}
      feedback={feedback}
      onFeedback={setFeedback}
      onAgain={() => { setFeedback(null); setChat(startChat(chat.language, chat.scene, chat.focus, chat.words, chat.register, chat.partner, chat.prepared)); }}
      onDone={onClose}
    />
  );
}

type Api = NonNullable<ToolScreenProps['readerApi']>;

/** The topic a scene practices, from the route's `focus` parameter; undefined when absent or unreadable. */
function focusOf(raw: string | undefined): SituationFocus | undefined {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<SituationFocus>) : undefined;
    return v && typeof v.title === 'string' && v.title ? { title: v.title, lead: typeof v.lead === 'string' ? v.lead : '' } : undefined;
  } catch {
    return undefined;
  }
}

function PickScene({ tool, api, language, onLanguage, heardOnly, onHeardOnly, focus, onStart }: {
  tool: ToolScreenProps['tool'];
  api: Api;
  language: Language;
  onLanguage: (l: Language) => void;
  heardOnly: boolean;
  onHeardOnly: (on: boolean) => void;
  focus?: SituationFocus;
  onStart: (scene: string) => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [own, setOwn] = useState('');
  const [typing, setTyping] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [scenes, setScenes] = useState<{ language: Language; names: string[] } | null>(null);
  const [at, setAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const motion = useRef<CardMotion | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    api.situationScenes(language)
      .then((names) => { if (live) { const some = names.slice(0, 12); setScenes({ language, names: some }); setAt(some.length ? Math.floor(Math.random() * some.length) : 0); } })
      .catch((e) => { if (live) setError(failureText(e, { what: "Couldn't get the scenes.", next: 'Try again, or type your own.' })); });
    return () => { live = false; };
  }, [api, language, loads]);

  const names = scenes && scenes.language === language ? scenes.names : null;
  const scene = names?.length ? names[at % names.length] : undefined;
  // With no scene to show (still loading, none, or none could be read) the field is the way in.
  const writing = typing || (!!names && !scene) || !!error;
  const loading = !names && !error;

  const front = browsing && names?.length ? (
    <View style={{ gap: space.m, width: '100%' }}>
      <Text style={{ ...type.overline, color: c.textSecondary, textAlign: 'center' }}>Pick a scene</Text>
      <Group>
        {names.map((name, i) => <NavRow key={name} first={i === 0} label={name} onPress={() => onStart(name)} />)}
      </Group>
    </View>
  ) : writing ? (
    <View style={{ gap: space.l, width: '100%', alignItems: 'center' }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>Your own scene</Text>
      <TextInput
        value={own}
        onChangeText={setOwn}
        onSubmitEditing={() => own.trim() && onStart(own)}
        returnKeyType="go"
        placeholder="In English, e.g. returning a shirt that's too small"
        accessibilityLabel="A situation of your own, in English"
        placeholderTextColor={c.textTertiary}
        selectionColor={c.accent}
        keyboardAppearance={dark ? 'dark' : 'light'}
        maxLength={200}
        autoFocus={typing}
        style={{
          ...type.body, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m, alignSelf: 'stretch',
          borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
        }}
      />
      {error ? <ErrorNote message={error} onRetry={() => setLoads((n) => n + 1)} /> : null}
      {scene ? (
        <Tappable onPress={() => { haptic.select(); setTyping(false); }} accessibilityRole="button" scaleTo={0.97} style={{ minHeight: MIN_TAP, justifyContent: 'center' }}>
          <Text style={{ ...type.callout, fontWeight: '600', color: c.accent }}>Pick a scene instead</Text>
        </Tappable>
      ) : null}
    </View>
  ) : (
    <View style={{ gap: space.m, alignItems: 'center' }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>Your scene</Text>
      <Text selectable maxFontSizeMultiplier={1.4} style={{ ...type.largeTitle, fontSize: 36, color: c.text, textAlign: 'center' }}>{scene}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center', maxWidth: 280 }}>Claude plays the other person using words from your deck, and tells you at the end what to fix.</Text>
      {focus ? <Text style={{ ...type.subhead, color: c.text, textAlign: 'center', maxWidth: 280 }}>{`Practicing: ${focus.title}. Claude works it into the scene and comments on how you used it at the end.`}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl, marginTop: space.s }}>
        {names && names.length > 1 ? (
          <Tappable onPress={() => { haptic.select(); setBrowsing(true); }} accessibilityRole="button" scaleTo={0.97} style={{ minHeight: MIN_TAP, justifyContent: 'center' }}>
            <Text style={{ ...type.callout, fontWeight: '600', color: c.accent }}>Browse all</Text>
          </Tappable>
        ) : null}
        <Tappable onPress={() => { haptic.select(); setTyping(true); }} accessibilityRole="button" scaleTo={0.97} style={{ minHeight: MIN_TAP, justifyContent: 'center' }}>
          <Text style={{ ...type.callout, fontWeight: '600', color: c.accent }}>Type your own</Text>
        </Tappable>
      </View>
    </View>
  );

  const footer = browsing && names?.length ? (
    <Button variant="secondary" label="Back to one scene" onPress={() => setBrowsing(false)} />
  ) : writing ? (
    <Button label="Start" onPress={() => onStart(own)} disabled={!own.trim()} />
  ) : (
    <View style={{ flexDirection: 'row', gap: space.s }}>
      <Button variant="secondary" label="Another" style={{ flex: 1 }} onPress={() => names && setAt((i) => (i + 1) % names.length)} disabled={!names || names.length < 2} />
      <Button label="Start" style={{ flex: 1 }} onPress={() => scene && onStart(scene)} disabled={!scene} />
    </View>
  );

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={onLanguage}
      shown={false}
      onRandomize={() => undefined}
      onShow={() => undefined}
      onMark={() => undefined}
      fill
      footer={footer}
      menu={[(
        <Stack.Toolbar.Menu key="lines" inline title="Their lines">
          <Stack.Toolbar.MenuAction isOn={!heardOnly} onPress={() => onHeardOnly(false)}>Read and heard</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction isOn={heardOnly} onPress={() => onHeardOnly(true)}>Heard only</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      )]}
    >
      {loading ? <View style={{ padding: space.l }}><Loading /></View> : (
        <PracticeCard questionKey={browsing ? 'browse' : writing ? 'own' : scene ?? ''} cardKey={browsing ? 'browse' : writing ? 'own' : scene ?? ''} swipe={false} motion={motion} onMark={() => {}} front={front} />
      )}
    </ToolScreen>
  );
}

function Talk({ api, repo, chat, onChat, heardOnly, feedback, onFeedback, onAgain, onDone }: {
  api: Api;
  repo: ToolScreenProps['repo'];
  chat: Chat;
  onChat: (chat: Chat) => void;
  heardOnly: boolean;
  feedback: SituationFeedback | null;
  onFeedback: (f: SituationFeedback | null) => void;
  onAgain: () => void;
  onDone: () => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const info = LANGUAGES[chat.language];
  const keyboardLang = useKeyboardLanguage(info.speech);
  const { thaiFont, textSize } = prefs();
  const fontSize = scaledFontSize(info.fontSize, textSize);
  const look = { fontSize, lineHeight: fontSize * info.lineHeight, fontFamily: readFont(chat.language, thaiFont).fontFamily };
  const [draft, setDraft] = useState('');
  // Hold to talk (Answer by speaking): what's heard fills the box, and letting go sends it once listening has ended.
  const [typingMode, setTypingMode] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const sendWhenHeard = useRef(false);
  const spoken = useSpokenAnswer(info.speech, {
    continuous: true,
    onBeforeListen: () => { player.pause(); phone.stop(); setDraft(''); },
    onHeard: (heard) => setDraft(heard),
  });
  const holding = spoken.available && !typingMode;
  const [waiting, setWaiting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // What went wrong, and what Try again does: none when the owner's line went back in the box to send again.
  const [problem, setProblem] = useState<{ message: string; retry?: () => void } | null>(null);
  const [added, setAdded] = useState<Record<string, 'adding' | 'added' | 'failed'>>({});
  const [deck, setDeck] = useState<string | null | undefined>(undefined);
  const [keptState, setKeptState] = useState<KeepState>('idle');
  // Counts requests: an answer that comes back after the screen moved on (Finish, Again, Back) is dropped.
  const asking = useRef(0);
  const saying = useRef(0);
  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  useTrackedPlayer(player);
  const phone = usePhoneSpeech(repo);
  useEffect(() => () => { asking.current++; saying.current++; phone.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Their line, aloud: Azure's recording when one was made (the setting is on), else the phone's voice
  // (also when Azure failed, so the button always plays). A slow line asks the server for a slow
  // recording, and falls back to stretching the normal one if there isn't one.
  const say = async (line: SituationTurn) => {
    const mine = ++saying.current;
    player.pause();
    phone.stop();
    const slow = isSlow(speedFor(prefs(), chat.language));
    if (!line.audio) { phone.sayLine(line.line, info.speech, slow); return; }
    let key = line.audio;
    let stretch = NORMAL_RATE;
    if (slow) {
      try {
        const got = await api.situationSlow(chat.language, (line.roles ?? chat.roles)?.gender ?? 'male', line.line);
        if (got.audio) key = got.audio; else stretch = SLOW_RATE;
      } catch {
        stretch = SLOW_RATE;
      }
      if (saying.current !== mine) return;
    }
    player.replace(api.situationAudio(key));
    player.setPlaybackRate(stretch, 'high');
    player.play();
  };
  const { scrollProps, bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();
  // The cards sit in a fixed layout, which the native header would otherwise cover (see useHeaderInset).
  const header = useHeaderInset();
  // scrollToEnd on content shorter than the view scrolls past the top inset, leaving the first line
  // under the header, so it's only called once the conversation overflows.
  const sizes = useRef({ view: 0, content: 0 });

  const turn = async (from: Chat) => {
    const mine = ++asking.current;
    setWaiting(true);
    setProblem(null);
    try {
      const got = await api.situationTurn(conversationOf(from, await loadParticle()), prefs().situationsAzure);
      if (asking.current !== mine) return;
      onChat(withTheirs(from, got));
      void say(got);
      setTimeout(() => { if (sizes.current.content > sizes.current.view) scrollProps.ref.current?.scrollToEnd({ animated: true }); }, 50);
    } catch (e) {
      if (asking.current !== mine) return;
      // A line of the owner's whose reply failed goes back in the box, so nothing typed is lost.
      const back = withoutMine(from);
      if (back) {
        onChat(back.chat);
        setDraft(back.text);
        setProblem({ message: failureText(e, { what: "Couldn't get the next line.", next: 'Your line is back in the box: send it again.' }) });
      } else {
        setProblem({ message: failureText(e, { what: "Couldn't start the conversation.", next: 'Try again.' }), retry: () => void turn(from) });
      }
    } finally {
      if (asking.current === mine) setWaiting(false);
    }
  };
  // The first line is theirs.
  useEffect(() => { if (!chat.lines.length && !feedback) void turn(chat); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Once a hold is let go and listening has ended, what was heard is sent (or nothing, if nothing was).
  useEffect(() => {
    if (spoken.listening || !sendWhenHeard.current) return;
    sendWhenHeard.current = false;
    sendText(draftRef.current);
  }, [spoken.listening]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => sendText(draft);
  const sendText = (text: string) => {
    if (!canSend(chat, text) || waiting) return;
    haptic.tap();
    const next = withMine(chat, text);
    setDraft('');
    onChat(next);
    void turn(next);
  };
  const finish = async () => {
    if (!canFinish(chat)) { onDone(); return; }
    const mine = ++asking.current;
    player.pause();
    phone.stop();
    Keyboard.dismiss();
    setWaiting(true);
    setFinishing(true);
    setProblem(null);
    try {
      const [got, settings] = await Promise.all([loadParticle().then((particle) => api.situationFeedback(conversationOf(chat, particle))), api.settings().catch(() => null)]);
      if (asking.current !== mine) return;
      setDeck(settings?.decks?.[chat.language] ?? null);
      onFeedback(got);
    } catch (e) {
      if (asking.current === mine) setProblem({ message: failureText(e, { what: "Couldn't get feedback on your lines.", next: 'Try again.' }), retry: () => void finish() });
    } finally {
      if (asking.current === mine) { setWaiting(false); setFinishing(false); }
    }
  };
  // The status line and any error sit below the lines: bring them into view so a tap on Finish visibly does something.
  useEffect(() => {
    if (waiting || problem) setTimeout(() => scrollProps.ref.current?.scrollToEnd({ animated: true }), 50);
  }, [waiting, problem]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (w: { word: string; english: string }) => {
    if (!deck) return;
    setAdded((a) => ({ ...a, [w.word]: 'adding' }));
    try {
      await api.queueNotes(chat.language, deck, [{ entry: w.word, meaning: w.english }]);
      setAdded((a) => ({ ...a, [w.word]: 'added' }));
      haptic.success();
    } catch {
      setAdded((a) => ({ ...a, [w.word]: 'failed' }));
    }
  };

  const name = chat.roles?.name ?? 'Them';
  if (feedback) {
    const mine = new Map(chat.lines.flatMap((l, i) => (l.speaker === 'you' ? [[i, l.text] as const] : [])));
    const keepable_ = keepable(feedback, mine);
    // Kept only when tapped: a rehearsal's mistakes shape the next theme ideas (src/reader/corrections.ts).
    const keepThese = async () => {
      if (keptState === 'saving' || keptState === 'kept') return;
      setKeptState('saving');
      try {
        saveKept(keep(await loadKept(), chat.language, keepable_, Date.now()));
        setKeptState('kept');
        haptic.success();
      } catch {
        setKeptState('failed');
      }
    };
    return (
      <Screen
        title="How it went"
        largeTitle={false}
        footer={(
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button variant="secondary" label="Play it again" style={{ flex: 1 }} onPress={onAgain} />
            <Button label="Done" style={{ flex: 1 }} onPress={onDone} />
          </View>
        )}
      >
        <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1, paddingTop: header.top }}>
          <CardSurface>
            <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.m }}>
              <SituationResult feedback={feedback} mine={mine} look={look} lang={info.speech} added={added} onAdd={deck ? (w) => void add(w) : null} scene={chat.scene} />
              {chat.words && keepable_.length ? <SituationKeep count={keepable_.length} state={keptState} onKeep={() => void keepThese()} /> : null}
            </ScrollView>
          </CardSurface>
        </View>
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
      <Screen
        title="Conversation"
        largeTitle={false}
        lockGesture={chat.lines.some((l) => l.speaker === 'you')}
        toolbar={(
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button accessibilityLabel="Finish the conversation and get feedback" onPress={() => void finish()}>Finish</Stack.Toolbar.Button>
          </Stack.Toolbar>
        )}
        footer={chat.done ? (
          <Button label="See how it went" busy={waiting} onPress={() => void finish()} />
        ) : (
          <View style={{ gap: space.xs }}>
            {holding ? (
              <>
                {draft ? <Text accessibilityLanguage={info.speech} style={{ ...type.body, color: c.text }}>{draft}</Text> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                  <View style={{ flex: 1 }}>
                    <HoldToTalk spoken={spoken} disabled={waiting || !canSend(chat, 'x')} onRelease={() => { sendWhenHeard.current = true; }} />
                  </View>
                  <Tappable
                    onPress={() => { haptic.select(); setTypingMode(true); }}
                    accessibilityRole="button"
                    accessibilityLabel="Type instead"
                    style={{ width: 52, height: 52, borderRadius: radius.pill, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Icon name="keyboard" size={18} color={c.text} />
                  </Tappable>
                </View>
                <ListeningNote spoken={spoken} language={info.name} />
                <Text style={{ ...type.caption, color: c.textSecondary }}>Hold to talk, let go to send. To write a word in [brackets], type instead.</Text>
              </>
            ) : (
            <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.s }}>
              <TextInput
                {...keyboardLang}
                value={draft}
                onChangeText={setDraft}
                multiline
                autoCorrect={false}
                spellCheck={false}
                placeholder={`Your reply, in ${info.name}`}
                accessibilityLabel={`Your reply, in ${info.name}`}
                placeholderTextColor={c.textTertiary}
                selectionColor={c.accent}
                keyboardAppearance={dark ? 'dark' : 'light'}
                style={{
                  ...type.body, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.xl, flex: 1,
                  borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.l, paddingVertical: space.s + 2, minHeight: MIN_TAP, maxHeight: 140,
                }}
              />
              <Tappable
                onPress={send}
                disabled={!canSend(chat, draft) || waiting}
                accessibilityRole="button"
                accessibilityLabel="Send"
                restOpacity={!canSend(chat, draft) || waiting ? 0.45 : 1}
                style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="arrow.up" size={18} color={c.onAccent} weight="bold" />
              </Tappable>
              {spoken.available ? (
                <Tappable
                  onPress={() => { haptic.select(); setTypingMode(false); }}
                  accessibilityRole="button"
                  accessibilityLabel="Speak instead"
                  style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="mic.fill" size={17} color={c.text} />
                </Tappable>
              ) : null}
            </View>
            <MissingKeyboardNote speechTag={info.speech} />
            <Text style={{ ...type.caption, color: c.textSecondary }}>{"Don't know a word? Write it in English in [brackets]. Tap a highlighted word for its meaning."}</Text>
            </>
            )}
          </View>
        )}
      >
        <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1, paddingTop: header.top }}>
          <CardSurface>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.l, gap: space.m }} {...scrollProps}
              onLayout={(e) => { sizes.current.view = e.nativeEvent.layout.height; }}
              onContentSizeChange={(_w, h) => { sizes.current.content = h; }}
            >
              <Text selectable style={{ ...type.headline, color: c.text, textAlign: 'center' }}>{chat.scene}</Text>
              {chat.roles ? (
                <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>{`You're ${chat.roles.you}. ${name} is ${chat.roles.them}.`}</Text>
              ) : null}
              {chat.lines.map((l, i) => (l.speaker === 'them'
                ? <TheirLine key={i} turn={l.turn} name={name} look={look} lang={info.speech} heardOnly={heardOnly} onPlay={() => void say(l.turn)} lookup={(word, english) => api.wordMeaning(chat.language, word, english)} />
                : <MyLine key={i} text={l.text} look={look} lang={info.speech} />))}
              {waiting ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{finishing ? 'Getting feedback on your lines...' : chat.lines.length ? `${name} is answering...` : 'Setting the scene...'}</Text> : null}
              {chat.done && !waiting ? <Help>{`${name} ended the conversation.`}</Help> : null}
              {problem ? <ErrorNote centered={!chat.lines.length} message={problem.message} onRetry={problem.retry} /> : null}
              {chat.lines.length >= 30 && !chat.done ? <Help>This conversation is getting long. Finish when you're ready to see how it went.</Help> : null}
            </ScrollView>
          </CardSurface>
        </View>
      </Screen>
    </View>
  );
}
