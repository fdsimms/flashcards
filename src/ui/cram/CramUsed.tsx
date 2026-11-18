import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramNotes, meaningOf } from '../../core/cram';
import { failureText } from '../../core/failure';
import { headword } from '../../core/forms';
import { haptic } from '../haptics';
import { Button, Divider, Group, Help, Icon, Loading, Screen } from '../kit';
import { MIN_TAP, readable, space, type, useTheme } from '../theme';
import { finishCram, saveCram, useCollection, useCrams } from '../useCrams';

/**
 * On the day: a cram's words as big rows to check off while they're used (a video call with a
 * tutor, say). The checks are kept on the phone as they're made, so the screen can be left and
 * come back to. Finish ends the cram: the words not checked go into the next cram.
 */
export function CramUsed({ repo, id, onDone }: { repo: NoteStore; id: string; onDone: () => void }) {
  const c = useTheme();
  const { crams } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === id);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  useEffect(() => { if (cram?.used) setUsed(new Set(cram.used)); }, [cram?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cram || !collection.loaded) return <Screen title="On the day"><Loading /></Screen>;
  const notes = cramNotes(cram, collection.notes);
  const toggle = (noteId: string) => {
    haptic.select();
    const next = new Set(used);
    if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
    setUsed(next);
    saveCram(repo, { ...cram, used: [...next] }).catch((e) => setProblem(failureText(e, { what: "Couldn't keep that check.", next: 'Try again.' })));
  };
  const finish = async () => {
    if (busy) return;
    haptic.tap();
    setBusy(true);
    setProblem(undefined);
    try {
      await finishCram(repo, cram, notes, used);
      haptic.success();
      onDone();
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't finish the cram.", next: 'Try again.' }));
      setBusy(false);
    }
  };
  const count = notes.filter((n) => used.has(n.id)).length;
  const rest = notes.length - count;
  return (
    <Screen
      title="On the day"
      footer={(
        <>
          {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          <Button label="Finish" onPress={finish} busy={busy} disabled={!notes.length} />
          <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>
            {`${count} of ${notes.length} used.${rest ? ` ${rest === 1 ? '1 goes' : `${rest} go`} into your next cram.` : ''}`}
          </Text>
        </>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Help>{`Check off each word as you use it. Finish ends ${cram.name}; the words you didn't use go into your next cram.`}</Help>
        <Group>
          {notes.map((note, i) => {
            const on = used.has(note.id);
            return (
              <Pressable
                key={note.id}
                onPress={() => toggle(note.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${headword(note)}, ${meaningOf(note)}`}
                style={({ pressed }) => ({ minHeight: MIN_TAP + space.l, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : 'transparent' })}
              >
                {i === 0 ? null : <Divider inset={space.l} />}
                <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={26} color={on ? c.countDue : c.textTertiary} weight="regular" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...type.headline, color: c.text }}>{headword(note)}</Text>
                  {meaningOf(note) ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{meaningOf(note)}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </Group>
      </ScrollView>
    </Screen>
  );
}
