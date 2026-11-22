import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { CramLine } from '../../core/cram';
import { failureText } from '../../core/failure';
import type { Language, WritingCheck } from '../../reader/api';
import { talkTextStyle, type TextSize } from '../../reader/fonts';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, Field, Help } from '../kit';
import { space, type, useTheme } from '../theme';

/**
 * Editing a talking point's story into what the learner would really say. Save has Claude check it
 * (`check`, Read & Listen's writing check, which keeps nothing and grades nothing), so it comes back
 * with its English: right, it's saved as written; with a mistake, the corrected version is shown with
 * the reason, to use or to keep their own. When the check can't be reached it can still be saved, as
 * written and without English.
 */
export function StoryEditor({ story, language, size, check, onSave, onCancel }: {
  story: CramLine;
  language: Language;
  size: TextSize;
  check: (attempt: string) => Promise<WritingCheck>;
  onSave: (line: CramLine) => Promise<void> | void;
  onCancel: () => void;
}) {
  const c = useTheme();
  const [draft, setDraft] = useState(story.text);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<{ attempt: string; result: WritingCheck }>();
  const [problem, setProblem] = useState<string>();
  const working = useRef(false);
  const info = LANGUAGES[language];
  const text = draft.replace(/\s+/g, ' ').trim();
  // What's shown belongs to what's typed now: a check of an earlier draft isn't.
  const result = checked?.attempt === text ? checked.result : undefined;

  const run = async (fn: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      await fn();
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't save the story.", next: 'Try again.' }));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const save = () => run(async () => {
    haptic.tap();
    if (!text) return;
    if (text === story.text) { onCancel(); return; }
    let answer: WritingCheck;
    try {
      answer = await check(text);
    } catch (e) {
      setChecked(undefined);
      throw e;
    }
    if (answer.verdict === 'right') { haptic.success(); await onSave({ text, english: answer.english }); return; }
    setChecked({ attempt: text, result: answer });
  });
  const keep = (line: CramLine) => run(async () => { haptic.tap(); await onSave(line); });

  return (
    <View style={{ gap: space.m }}>
      <Card>
        <Field label="Your version" value={draft} onChangeText={setDraft} multiline autoFocus keyboardLanguage={language} />
        <Help>Change it to what you'd really say. Claude checks it and writes the English.</Help>
      </Card>
      {result ? (
        <Card>
          <Text style={{ ...type.footnote, color: c.textSecondary, fontWeight: '600' }}>{result.verdict === 'almost' ? 'ALMOST' : 'A FEW THINGS TO FIX'}</Text>
          <Text style={{ ...talkTextStyle(info, size), color: c.text }}>{result.corrected}</Text>
          {result.english ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{result.english}</Text> : null}
          {result.notes.map((n) => <Help key={n}>{n}</Help>)}
          <Button label="Use the corrected one" busy={busy} onPress={() => void keep({ text: result.corrected, english: result.english })} />
          <Button variant="secondary" label="Keep mine" disabled={busy} onPress={() => void keep({ text, english: result.english })} />
        </Card>
      ) : (
        <Button label="Check and save" busy={busy} disabled={!text} onPress={() => void save()} />
      )}
      {problem ? (
        <>
          <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text>
          <Button variant="secondary" label="Save without checking" disabled={busy || !text} onPress={() => void keep({ text, english: '' })} />
        </>
      ) : null}
      <Button variant="secondary" label="Cancel" disabled={busy} onPress={() => { haptic.tap(); onCancel(); }} />
    </View>
  );
}
