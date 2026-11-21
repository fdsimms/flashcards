import { usePreventRemove } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { saveNoteTypeLook } from '../anki/noteTypeService';
import type { NoteStore } from '../anki/noteService';
import { failureText } from '../core/failure';
import { drawnByFranki, templateProblems } from '../core/noteTypeEdits';
import type { NoteType } from '../core/types';
import { Button, Card, ErrorNote, Field, Help, Loading, Screen, SectionTitle, Tag } from './kit';
import { readable, space, type as typeScale, useTheme } from './theme';
import { useHeaderInset } from './useHeaderInset';
import { useKeyboardScroll } from './useKeyboardScroll';

type Draft = Pick<NoteType, 'templates' | 'css'>;

/**
 * One note type: each card type's front and back template, and the styling, edited and saved
 * together (`saveNoteTypeLook`, which writes the kept Anki collection so sync carries it). Its
 * fields are listed for reference; adding or renaming them is a schema change, made in Anki. What
 * Anki would refuse is said under the template as it's typed, from the same check the save runs.
 */
export function NoteTypeEditor({ repo, name, onClose }: { repo: NoteStore; name: string; onClose: () => void }) {
  const c = useTheme();
  const [saved, setSaved] = useState<NoteType | null>();
  const [draft, setDraft] = useState<Draft>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  // The scroll view's top at rest is the header's height above zero (contentInsetAdjustmentBehavior).
  const header = useHeaderInset();

  useEffect(() => {
    let live = true;
    repo.listNoteTypes().then((types) => {
      if (!live) return;
      const nt = types.get(name) ?? null;
      setSaved(nt);
      if (nt) setDraft({ templates: nt.templates, css: nt.css });
    }).catch((e) => { if (live) setLoadError(failureText(e, { what: "Couldn't load the note type.", next: 'Go back and try again.' })); });
    return () => { live = false; };
  }, [repo, name]);

  const edited: NoteType | undefined = saved && draft ? { ...saved, ...draft } : undefined;
  const changed = !!saved && !!draft && (draft.css !== saved.css || draft.templates.some((t, i) => t.front !== saved.templates[i].front || t.back !== saved.templates[i].back));
  const problems = edited ? templateProblems(edited) : [];
  const problemAt = (ord: number, side: 'front' | 'back') => problems.find((p) => p.ord === ord && p.side === side)?.message;

  const setTemplate = (ord: number, side: 'front' | 'back', text: string) => {
    setError(null);
    setDraft((d) => d && { ...d, templates: d.templates.map((t) => (t.ord === ord ? { ...t, [side]: text } : t)) });
  };

  const stopAsking = usePreventRemove(changed, ({ repeat }) => {
    Alert.alert('Discard changes?', "If you leave now, they'll be lost.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: repeat },
    ]);
  });

  const save = async () => {
    if (!draft || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await saveNoteTypeLook(repo, name, draft);
      stopAsking();
      onClose();
    } catch (e) {
      setError(failureText(e, { what: "Couldn't save the note type.", next: 'Try again.' }));
      // The reason shows above the first card type: back to the top, or a Save at the bottom looks like it did nothing.
      scrollProps.ref.current?.scrollTo({ y: -header.top, animated: true });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen
      title={name}
      largeTitle={false}
      lockGesture={changed}
      footer={edited ? <Button label="Save" onPress={save} busy={busy} disabled={!changed || problems.length > 0} /> : undefined}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        {loadError ? <ErrorNote message={loadError} /> : saved === undefined ? <Loading /> : !edited ? (
          <Help>Franki has no note type called {name} anymore. It may have been renamed or deleted in Anki.</Help>
        ) : (
          <>
            {error ? <ErrorNote message={error} /> : null}
            <Help>
              {drawnByFranki(edited)
                ? 'Franki draws these cards itself, so these templates change how they look in Anki, not here. Changes reach Anki at the next sync.'
                : 'Changes show on these cards here at once, and reach Anki at the next sync.'}
            </Help>
            <SectionTitle>Fields</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingHorizontal: space.l }} accessibilityLabel={`Fields: ${edited.fields.join(', ')}`}>
              {edited.fields.map((f) => <Tag key={f} text={f} color={c.textSecondary} fill={c.fill} />)}
            </View>
            {edited.templates.map((t) => (
              <React.Fragment key={t.ord}>
                <SectionTitle>{t.name}</SectionTitle>
                <Card>
                  {(['front', 'back'] as const).map((side) => {
                    const problem = problemAt(t.ord, side);
                    return (
                      <View key={side} style={{ gap: space.xs }}>
                        <Field
                          label={side === 'front' ? 'Front template' : 'Back template'}
                          code
                          multiline
                          autoCapitalize="none"
                          autoCorrect={false}
                          spellCheck={false}
                          value={t[side]}
                          onChangeText={(text) => setTemplate(t.ord, side, text)}
                          error={!!problem}
                        />
                        {problem ? <Text style={{ ...typeScale.subhead, color: c.danger }}>{problem}</Text> : null}
                      </View>
                    );
                  })}
                </Card>
              </React.Fragment>
            ))}
            <SectionTitle>Styling</SectionTitle>
            <Card>
              <Field
                label="Styling (CSS), for every card type"
                code
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                value={draft!.css}
                onChangeText={(css) => { setError(null); setDraft((d) => d && { ...d, css }); }}
              />
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
