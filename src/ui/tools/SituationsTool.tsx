import { useAudioPlayer } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { failureText } from '../../core/failure';
import type { Language, SituationFeedback } from '../../reader/api';
import { readFont, scaledFontSize } from '../../reader/fonts';
import { LANGUAGES } from '../../reader/languages';
import { canFinish, canSend, conversationOf, startChat, withMine, withoutMine, withTheirs, type Chat } from '../../reader/situations';
import { prefs } from '../../reader/storage';
import { haptic } from '../haptics';
import { Button, Card, Chip, ErrorNote, Group, Help, HeaderAction, Icon, Loading, NavRow, Screen, Tappable } from '../kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';
import type { ToolScreenProps } from './index';
import { MyLine, SituationResult, TheirLine } from './SituationParts';
import { HoldToTalk, ListeningNote } from '../SpeakButton';
import { useSpokenAnswer } from '../useSpokenAnswer';
import { ControlLabel, ToolScreen, useToolLanguage } from './ToolScreen';

/**
 * Situations (server/reader situations.py): pick a scene or type one, then talk it through with Claude,
 * who plays the other person from the deck's words, each of their lines spoken by an Azure voice. Finish
 * asks for feedback on each of the owner's lines and words worth adding. The conversation lives here and
 * goes to the server with each turn; nothing is kept, and nothing grades a card or writes a note (Add
 * only puts a word in the note queue, for the note editor).
 */
export function SituationsTool({ tool, readerApi, onClose }: ToolScreenProps) {
  const [language, setLanguage] = useToolLanguage(tool);
  const [chat, setChat] = useState<Chat | null>(null);
  const [heardOnly, setHeardOnly] = useState(false);
  const [feedback, setFeedback] = useState<SituationFeedback | null>(null);

  if (!readerApi) {
    return (
      <Screen title={tool.title} largeTitle={false}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l }}>
          <Card><Help>{"Situations are played by Claude on Read & Listen's server. Turn on Read & Listen in Settings to use them."}</Help></Card>
        </ScrollView>
      </Screen>
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
        onStart={(scene) => { setFeedback(null); setChat(startChat(language, scene)); }}
      />
    );
  }
  return (
    <Talk
      api={readerApi}
      chat={chat}
      onChat={setChat}
      heardOnly={heardOnly}
      feedback={feedback}
      onFeedback={setFeedback}
      onAgain={() => { setFeedback(null); setChat(startChat(chat.language, chat.scene)); }}
      onDone={onClose}
    />
  );
}

type Api = NonNullable<ToolScreenProps['readerApi']>;

function PickScene({ tool, api, language, onLanguage, heardOnly, onHeardOnly, onStart }: {
  tool: ToolScreenProps['tool'];
  api: Api;
  language: Language;
  onLanguage: (l: Language) => void;
  heardOnly: boolean;
  onHeardOnly: (on: boolean) => void;
  onStart: (scene: string) => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [own, setOwn] = useState('');
  const [scenes, setScenes] = useState<{ language: Language; names: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    api.situationScenes(language)
      .then((names) => { if (live) setScenes({ language, names }); })
      .catch((e) => { if (live) setError(failureText(e, { what: "Couldn't get the scenes.", next: 'Try again, or type your own.' })); });
    return () => { live = false; };
  }, [api, language, loads]);

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={onLanguage}
      shown={false}
      onRandomize={() => undefined}
      onShow={() => undefined}
      onMark={() => undefined}
      actions={{ primary: { label: 'Start', onPress: () => onStart(own), disabled: !own.trim() } }}
    >
      <Help>Talk your way through a scene. Claude plays the other person using words from your deck, and tells you at the end what to fix.</Help>
      <View style={{ gap: space.s }}>
        <ControlLabel>Your own</ControlLabel>
        <TextInput
          value={own}
          onChangeText={setOwn}
          onSubmitEditing={() => own.trim() && onStart(own)}
          returnKeyType="go"
          placeholder="A situation, in English: returning a shirt that's too small"
          accessibilityLabel="A situation of your own, in English"
          placeholderTextColor={c.textTertiary}
          selectionColor={c.accent}
          keyboardAppearance={dark ? 'dark' : 'light'}
          maxLength={200}
          style={{
            ...type.body, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m,
            borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
          }}
        />
      </View>
      <View style={{ gap: space.s }}>
        <ControlLabel>Or pick one</ControlLabel>
        {error ? <ErrorNote message={error} onRetry={() => setLoads((n) => n + 1)} /> : !scenes || scenes.language !== language ? <Loading /> : (
          <Group>
            {scenes.names.slice(0, 12).map((name, i) => <NavRow key={name} first={i === 0} label={name} onPress={() => onStart(name)} />)}
          </Group>
        )}
      </View>
      <View style={{ gap: space.s }}>
        <ControlLabel>Their lines</ControlLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          <Chip label="Read and heard" selected={!heardOnly} onPress={() => onHeardOnly(false)} />
          <Chip label="Heard only" selected={heardOnly} onPress={() => onHeardOnly(true)} />
        </View>
      </View>
    </ToolScreen>
  );
}

function Talk({ api, chat, onChat, heardOnly, feedback, onFeedback, onAgain, onDone }: {
  api: Api;
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
    onBeforeListen: () => { player.pause(); setDraft(''); },
    onHeard: (heard) => setDraft(heard),
  });
  const holding = spoken.available && !typingMode;
  const [waiting, setWaiting] = useState(false);
  // What went wrong, and what Try again does: none when the owner's line went back in the box to send again.
  const [problem, setProblem] = useState<{ message: string; retry?: () => void } | null>(null);
  const [added, setAdded] = useState<Record<string, 'adding' | 'added' | 'failed'>>({});
  const [deck, setDeck] = useState<string | null | undefined>(undefined);
  // Counts requests: an answer that comes back after the screen moved on (Finish, Again, Back) is dropped.
  const asking = useRef(0);
  useEffect(() => () => { asking.current++; }, []);
  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  const play = (key: string | null) => {
    if (!key) return;
    player.replace(api.situationAudio(key));
    player.setPlaybackRate(prefs().rate, 'high');
    player.play();
  };
  const { scrollProps, bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();

  const turn = async (from: Chat) => {
    const mine = ++asking.current;
    setWaiting(true);
    setProblem(null);
    try {
      const got = await api.situationTurn(conversationOf(from));
      if (asking.current !== mine) return;
      onChat(withTheirs(from, got));
      play(got.audio);
      setTimeout(() => scrollProps.ref.current?.scrollToEnd({ animated: true }), 50);
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
    setWaiting(true);
    setProblem(null);
    try {
      const [got, settings] = await Promise.all([api.situationFeedback(conversationOf(chat)), api.settings().catch(() => null)]);
      if (asking.current !== mine) return;
      setDeck(settings?.decks?.[chat.language] ?? null);
      onFeedback(got);
    } catch (e) {
      if (asking.current === mine) setProblem({ message: failureText(e, { what: "Couldn't get feedback on your lines.", next: 'Try again.' }), retry: () => void finish() });
    } finally {
      if (asking.current === mine) setWaiting(false);
    }
  };
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
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.m }}>
          <SituationResult feedback={feedback} mine={mine} look={look} lang={info.speech} added={added} onAdd={deck ? (w) => void add(w) : null} />
        </ScrollView>
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
      <Screen
        title={chat.scene}
        largeTitle={false}
        lockGesture={chat.lines.some((l) => l.speaker === 'you')}
        toolbar={<HeaderAction label="Finish" onPress={() => void finish()} />}
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
            <Text style={{ ...type.caption, color: c.textSecondary }}>{"Don't know a word? Write it in English in [brackets]. Tap a highlighted word for its meaning."}</Text>
            </>
            )}
          </View>
        )}
      >
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.l, gap: space.m }} {...scrollProps}>
          {chat.roles ? (
            <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>{`You're ${chat.roles.you}. ${name} is ${chat.roles.them}.`}</Text>
          ) : null}
          {chat.lines.map((l, i) => (l.speaker === 'them'
            ? <TheirLine key={i} turn={l.turn} name={name} look={look} lang={info.speech} heardOnly={heardOnly} onPlay={l.turn.audio ? () => play(l.turn.audio) : undefined} />
            : <MyLine key={i} text={l.text} look={look} lang={info.speech} />))}
          {waiting ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{chat.lines.length ? `${name} is answering...` : 'Setting the scene...'}</Text> : null}
          {chat.done && !waiting ? <Help>{`${name} ended the conversation.`}</Help> : null}
          {problem ? <ErrorNote message={problem.message} onRetry={problem.retry} /> : null}
          {chat.lines.length >= 30 && !chat.done ? <Help>This conversation is getting long. Finish when you're ready to see how it went.</Help> : null}
        </ScrollView>
      </Screen>
    </View>
  );
}
