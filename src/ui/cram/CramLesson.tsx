import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramLanguageOf, cramNotes, meaningOf, withCapture, withoutCapture, withQuestionAsked, type Cram } from '../../core/cram';
import { failureText } from '../../core/failure';
import { headword } from '../../core/forms';
import { haptic } from '../haptics';
import { Button, Field, Group, Help, Icon, Loading, Screen, SectionTitle, Tappable } from '../kit';
import { radius, readable, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { cramsNow, finishCram, saveCram, useCollection, useCrams } from '../useCrams';
import { useWordAudio } from '../useWordAudio';
import { CheckRow } from './CramBits';

/**
 * Lesson mode, during the lesson itself (a video call with a tutor, say): the questions to ask,
 * checked off as they're asked; the words as big tiles, tapped when used (a long press plays one);
 * and a field to jot down a word the tutor used, kept on the cram to make cards from afterwards.
 * Every tap is kept as it's made, so the screen can be left and come back to. Finish ends the cram:
 * the words not used go into the next cram.
 */
export function CramLesson({ repo, id, onDone }: { repo: NoteStore; id: string; onDone: () => void }) {
  const c = useTheme();
  const { crams } = useCrams(repo);
  const collection = useCollection(repo);
  const playWord = useWordAudio(repo);
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const cram = crams.find((x) => x.id === id);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  // The saves, one after another, each reading the cram as the last one left it.
  const saves = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { if (cram?.used) setUsed(new Set(cram.used)); }, [cram?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cram || !collection.loaded) return <Screen title="Lesson"><Loading /></Screen>;
  const notes = cramNotes(cram, collection.notes);
  const language = cramLanguageOf(cram, collection.notes);
  const questions = cram.questions ?? [];
  const captured = cram.captured ?? [];
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
    keep((now) => ({ ...now, used: [...next] }), "Couldn't keep that check.");
  };
  const jot = () => {
    if (!draft.trim()) return;
    haptic.tap();
    keep((now) => withCapture(now, draft), "Couldn't keep that word.");
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
      footer={(
        <>
          {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          <Button label="Finish" onPress={finish} busy={busy} />
          <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>
            {`${count} of ${notes.length} used.${rest ? ` ${rest === 1 ? '1 goes' : `${rest} go`} into your next cram.` : ''}`}
          </Text>
        </>
      )}
    >
      <ScrollView {...scrollProps} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl + bottomPadding, gap: space.m }}>
        <Text style={{ ...type.headline, color: c.text }}>{cram.name}</Text>
        {questions.length ? (
          <>
            <SectionTitle>{`Ask · ${asked} of ${questions.length} asked`}</SectionTitle>
            <Group>
              {questions.map((q, i) => (
                <CheckRow key={q.id} first={i === 0} big color={c.countDue} label={q.text} checked={!!q.asked} onPress={() => { haptic.select(); keep((now) => withQuestionAsked(now, q.id, !q.asked), "Couldn't keep that check."); }} />
              ))}
            </Group>
          </>
        ) : null}

        <SectionTitle>{`Say · ${count} of ${notes.length} used`}</SectionTitle>
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
                      flexGrow: 1, flexBasis: '45%', minHeight: 72, gap: 2, padding: space.m, borderRadius: radius.m, borderWidth: 1.5,
                      backgroundColor: on ? c.goodFill : c.surface, borderColor: on ? c.countDue : c.border,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs }}>
                      <Text style={{ ...type.title, color: on ? c.goodInk : c.text, flex: 1 }}>{word || 'Untitled'}</Text>
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

        <SectionTitle>New from the lesson</SectionTitle>
        {captured.length ? (
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
                <Text style={{ ...type.subhead, color: c.text }}>{text}</Text>
                <Icon name="xmark" size={11} color={c.textSecondary} />
              </Tappable>
            ))}
          </View>
        ) : null}
        <Field
          label="A word or phrase your tutor used"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={jot}
          submitBehavior="submit"
          returnKeyType="done"
          autoCapitalize="none"
          placeholder="Type it, or use the keyboard's microphone"
        />
        <Help>Kept on the cram. Make cards from them on its page afterwards.</Help>
      </ScrollView>
    </Screen>
  );
}
