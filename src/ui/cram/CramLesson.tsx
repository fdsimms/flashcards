import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramLanguageOf, cramNotes, meaningOf, talkSummary, withCapture, withoutCapture, withQuestionAsked, withTalkAsked, type Cram, type CramTalk } from '../../core/cram';
import { Stack } from 'expo-router';
import { failureText } from '../../core/failure';
import { headword } from '../../core/forms';
import { talkTextStyle } from '../../reader/fonts';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, Field, Group, Help, Icon, Loading, Screen, SectionTitle, Tappable } from '../kit';
import { radius, readable, smooth, space, type, useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { cramsNow, finishCram, saveCram, useCollection, useCrams } from '../useCrams';
import { usePhoneSpeech } from '../usePhoneSpeech';
import { useWordAudio } from '../useWordAudio';
import { phraseIsUsed, withPhraseUsed } from '../../core/cramPhrases';
import { CheckRow } from './CramBits';
import { TalkLine } from './TalkLine';
import { talkSizeMenu, useTalkSize } from './talkSize';
import { useTextFont } from '../textMenu';
import { withThaiLineHeight } from '../../core/script';

/**
 * Lesson mode, during the lesson itself (a video call with a tutor, say), on one screen: the talking
 * points first (one open at a time, the first to begin with), each with the questions you ask to
 * check off as they're asked, the ones the tutor may ask with your answer, and your story; then the
 * questions about the language, checked off too; then the phrases, checked off as they're used; then
 * the words as big tiles, tapped when used (a
 * long press plays one). A field in the footer, always a tap away, jots down a word the tutor used,
 * kept on the cram to make cards from afterwards. Every tap is kept as it's made, so the screen can be
 * left and come back to. Finish ends the cram: the words not used go into the next cram.
 */
export function CramLesson({ repo, id, onDone }: { repo: NoteStore; id: string; onDone: () => void }) {
  const c = useTheme();
  const { crams } = useCrams(repo);
  const collection = useCollection(repo);
  const playWord = useWordAudio(repo);
  const phone = usePhoneSpeech(repo);
  // The jot field is in the footer, which the screen doesn't lift over the keyboard: it's raised by the
  // keyboard's height here (less the home indicator's inset, which the footer already pads by).
  const { bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();
  const cram = crams.find((x) => x.id === id);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // The talking point open, by its title; unset, the first one is.
  const [openTalk, setOpenTalk] = useState<string | null>();
  const [problem, setProblem] = useState<string>();
  // The saves, one after another, each reading the cram as the last one left it.
  const saves = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { if (cram?.used) setUsed(new Set(cram.used)); }, [cram?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [size, chooseSize] = useTalkSize();
  const lessonText = useTextFont(cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined);
  if (!cram || !collection.loaded) return <Screen title="Lesson"><Loading /></Screen>;
  const notes = cramNotes(cram, collection.notes);
  const language = cramLanguageOf(cram, collection.notes);
  const questions = cram.questions ?? [];
  const inLanguage = language ? talkTextStyle(LANGUAGES[language], size, 1) : undefined;
  const captured = cram.captured ?? [];
  const talks = cram.themes ?? [];
  const phrases = cram.phrases ?? [];
  const opened = openTalk === undefined ? talks[0]?.title : openTalk;
  const say = (text: string) => { if (language) phone.sayLine(text, LANGUAGES[language].speech, false); };
  const overline = { ...type.footnote, color: c.textSecondary, fontWeight: '600' as const };
  // Each change starts from the cram as the save before it left it, so two quick taps both count.
  const keep = (change: (now: Cram) => Cram | undefined, what: string) => {
    setProblem(undefined);
    saves.current = saves.current.then(async () => {
      const next = change(cramsNow().find((x) => x.id === id) ?? cram);
      if (next) await saveCram(repo, next);
    }).catch((e) => setProblem(failureText(e, { what, next: 'Try again.' })));
  };
  const toggleWord = (noteId: string) => {
    haptic.select();
    const next = new Set(used);
    if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
    setUsed(next);
    keep((now) => ({ ...now, used: [...next] }), "Couldn't save that check mark.");
  };
  const jot = () => {
    if (!draft.trim()) return;
    haptic.tap();
    keep((now) => withCapture(now, draft), "Couldn't save that word.");
    setDraft('');
  };
  const finish = async () => {
    if (busy) return;
    haptic.tap();
    setBusy(true);
    setProblem(undefined);
    try {
      await saves.current;
      await finishCram(repo, cramsNow().find((x) => x.id === id) ?? cram, notes, used);
      haptic.success();
      onDone();
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't finish the cram.", next: 'Try again.' }));
      setBusy(false);
    }
  };
  const count = notes.filter((n) => used.has(n.id)).length;
  const rest = notes.length - count;
  const asked = questions.filter((q) => q.asked).length;
  return (
    <Screen
      title="Lesson"
      largeTitle={false}
      toolbar={<Stack.Toolbar placement="right">{talkSizeMenu(size, chooseSize, lessonText)}</Stack.Toolbar>}
      footerStyle={keyboard ? { marginBottom: Math.max(0, keyboard - insets.bottom) } : undefined}
      footer={(
        <>
          {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          <Field
            label="Jot down a word your tutor used"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={jot}
            submitBehavior="submit"
            returnKeyType="done"
            autoCapitalize="none"
            placeholder="Type it, or use the keyboard's microphone"
          />
          <Button label="Finish" onPress={finish} busy={busy} />
          <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>
            {`${count} of ${notes.length} used.${rest ? ` ${rest === 1 ? '1 goes' : `${rest} go`} into your next cram.` : ''}`}
          </Text>
        </>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Text style={{ ...type.headline, color: c.text }}>{cram.name}</Text>
        {talks.map((talk) => (
          <LessonTalk
            key={talk.title}
            talk={talk}
            open={opened === talk.title}
            onToggle={() => { haptic.select(); setOpenTalk(opened === talk.title ? null : talk.title); }}
            onAsked={(text, on) => { haptic.select(); keep((now) => withTalkAsked(now, talk.title, text, on), "Couldn't save that check mark."); }}
            language={language}
            size={size}
            say={say}
            overline={overline}
          />
        ))}
        {questions.length ? (
          <>
            <SectionTitle>{`Questions about ${language ? LANGUAGES[language].name : 'the language'} · ${asked} of ${questions.length} asked`}</SectionTitle>
            <Group>
              {questions.map((q, i) => (
                <CheckRow key={q.id} first={i === 0} big color={c.countDue} label={q.text} labelSize={language ? talkTextStyle(LANGUAGES[language], size, 0.9) : undefined} checked={!!q.asked} onPress={() => { haptic.select(); keep((now) => withQuestionAsked(now, q.id, !q.asked), "Couldn't save that check mark."); }} />
              ))}
            </Group>
          </>
        ) : null}

        {phrases.length ? (
          <>
            <SectionTitle>{`Phrases · ${phrases.filter((p) => phraseIsUsed(cram, p)).length} of ${phrases.length} used`}</SectionTitle>
            <Group>
              {phrases.map((p, i) => (
                <CheckRow
                  key={p.text}
                  first={i === 0}
                  big
                  color={c.countDue}
                  label={p.text}
                  detail={p.english}
                  labelSize={inLanguage}
                  checked={phraseIsUsed(cram, p)}
                  onPress={() => { haptic.select(); keep((now) => withPhraseUsed(now, p.text, !phraseIsUsed(now, p)), "Couldn't save that check mark."); }}
                />
              ))}
            </Group>
          </>
        ) : null}

        <SectionTitle>{`Words · ${count} of ${notes.length} used`}</SectionTitle>
        {notes.length ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {notes.map((note) => {
                const on = used.has(note.id);
                const word = headword(note);
                const meaning = meaningOf(note);
                return (
                  <Tappable
                    key={note.id}
                    onPress={() => toggleWord(note.id)}
                    onLongPress={() => { if (language) { haptic.tap(); playWord(word, language).catch(() => undefined); } }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${word}, ${meaning}`}
                    accessibilityHint={language ? 'Long press to hear it.' : undefined}
                    scaleTo={0.96}
                    style={{
                      flexGrow: 1, flexBasis: '45%', minHeight: 72, gap: space.xs, padding: space.m, borderRadius: radius.m, ...smooth, borderWidth: 1.5,
                      backgroundColor: on ? c.goodFill : c.surface, borderColor: on ? c.countDue : c.border,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs }}>
                      <Text style={{ ...withThaiLineHeight(type.title, word), ...inLanguage, color: on ? c.goodInk : c.text, flex: 1 }}>{word || 'Untitled'}</Text>
                      {on ? <Icon name="checkmark.circle.fill" size={18} color={c.countDue} /> : null}
                    </View>
                    {meaning ? <Text numberOfLines={2} style={{ ...type.footnote, color: c.textSecondary }}>{meaning}</Text> : null}
                  </Tappable>
                );
              })}
            </View>
            <Help>{language ? 'Tap a word when you use it. Long press to hear it.' : 'Tap a word when you use it.'}</Help>
          </>
        ) : <Help>This cram has no words yet.</Help>}

        {captured.length ? <SectionTitle>New from the lesson</SectionTitle> : null}
        {captured.length ? (
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {captured.map((text) => (
                <Tappable
                  key={text}
                  onPress={() => { haptic.tap(); keep((now) => withoutCapture(now, text), "Couldn't change the cram."); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${text}`}
                  scaleTo={0.95}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, backgroundColor: c.fill, borderRadius: radius.pill, paddingVertical: space.xs + 2, paddingLeft: space.m, paddingRight: space.s }}
                >
                  <Text style={{ ...type.subhead, ...(language ? talkTextStyle(LANGUAGES[language], size, 0.8) : {}), color: c.text }}>{text}</Text>
                  <Icon name="xmark" size={11} color={c.textSecondary} />
                </Tappable>
              ))}
            </View>
            <Help>These stay with the cram. Make cards from them on its page after the lesson.</Help>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** A talking point in lesson mode: folded to its title and what it holds, or open to its questions (yours checked off as asked), the tutor's with your answers, and your story. */
function LessonTalk({ talk, open, onToggle, onAsked, language, size, say, overline }: {
  talk: CramTalk;
  open: boolean;
  onToggle: () => void;
  onAsked: (text: string, asked: boolean) => void;
  language: ReturnType<typeof cramLanguageOf>;
  size: ReturnType<typeof useTalkSize>[0];
  say: (text: string) => void;
  overline: object;
}) {
  const c = useTheme();
  const unknown = talk.unknown ?? [];
  const asked = new Set(talk.asked ?? []);
  return (
    <Card style={{ gap: space.s }}>
      <Tappable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={talk.title} style={{ gap: space.xs, minHeight: 44, justifyContent: 'center' }}>
        <Text style={overline}>{talk.title.toUpperCase()}</Text>
        {!open ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{talkSummary(talk)}</Text> : null}
      </Tappable>
      {open ? (
        <>
          {talk.questions.length ? <Text style={overline}>YOU ASK</Text> : null}
          {talk.questions.map((q) => {
            const on = asked.has(q.text);
            return (
              <View key={q.text} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
                <Tappable onPress={() => onAsked(q.text, !on)} hitSlop={space.s} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Asked: ${q.text}`} style={{ paddingTop: space.xs + 2 }}>
                  <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={22} color={on ? c.countDue : c.textTertiary} />
                </Tappable>
                <View style={{ flex: 1 }}>
                  <TalkLine text={q.text} english={q.english} language={language} size={size} unknown={unknown} onSay={say} muted={on} />
                </View>
              </View>
            );
          })}
          {talk.expects?.length ? <Text style={{ ...overline, paddingTop: space.xs }}>THEY MAY ASK YOU</Text> : null}
          {talk.expects?.map((e) => (
            <View key={e.question.text}>
              <TalkLine text={e.question.text} english={e.question.english} language={language} size={size} unknown={unknown} onSay={say} />
              <View style={{ borderLeftWidth: 3, borderLeftColor: c.accentFill, paddingLeft: space.s + 2, marginTop: 2 }}>
                <TalkLine text={e.answer.text} english={e.answer.english} language={language} size={size} unknown={unknown} onSay={say} scale={0.9} />
              </View>
            </View>
          ))}
          {talk.story ? (
            <>
              <Text style={{ ...overline, paddingTop: space.xs }}>YOUR STORY</Text>
              <TalkLine text={talk.story.text} english={talk.story.english} language={language} size={size} unknown={unknown} onSay={say} />
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
