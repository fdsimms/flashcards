import { usePreventRemove } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { loadPreset, savePreset, type PresetView } from '../anki/presetService';
import { failureText } from '../core/failure';
import { ownValuesNote, parsePresetForm, presetForm, presetIntro, RETENTION_MAX, RETENTION_MIN, type PresetForm } from '../core/presetOptions';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { Button, Card, Field, Help, Loading, Screen, SectionTitle } from './kit';
import { readable, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/**
 * Anki options (from Deck options): the daily limits, learning steps, maximum interval and
 * desired retention of the Anki preset a deck uses, written into the Anki collection
 * (`savePreset`) so every device follows after sync. A preset is shared, so the screen lists
 * every deck the change applies to, and what any of them keeps for itself, before Save.
 */
export function DeckPreset({ repo, deck }: { repo: Repo & AnkiLink; deck: string }) {
  const c = useTheme();
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const [preset, setPreset] = useState<PresetView>();
  const [form, setForm] = useState<PresetForm>();
  const [errors, setErrors] = useState<Partial<PresetForm>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const current = useRef(deck);
  current.current = deck;

  const load = async () => {
    const v = await loadPreset(repo, deck);
    // The screen can be left or reopened on another deck while the read is out.
    if (current.current !== deck) return;
    setPreset(v);
    setForm(presetForm(v.options));
    setErrors({});
  };
  useEffect(() => {
    setLoadError(null);
    load().catch((e) => setLoadError(failureText(e, { what: "Couldn't load this deck's Anki options.", next: 'Try again.' })));
  }, [repo, deck, attempt]);

  const changed = !!preset && !!form && (Object.keys(form) as (keyof PresetForm)[]).some((k) => form[k] !== presetForm(preset.options)[k]);

  usePreventRemove(changed && !busy, ({ repeat }) => {
    Alert.alert('Discard changes?', "If you leave now, they'll be lost.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: repeat },
    ]);
  });

  const edit = (key: keyof PresetForm) => (text: string) => {
    setForm((f) => (f ? { ...f, [key]: text } : f));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const save = async () => {
    if (!preset || !form || busy) return;
    const parsed = parsePresetForm(form);
    if ('errors' in parsed) { setErrors(parsed.errors); return; }
    setBusy(true);
    try {
      await savePreset(repo, deck, preset.presetId, parsed.options);
      await load();
    } catch (e) {
      Alert.alert("Couldn't save these options", failureText(e, { next: 'Try again.' }));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof PresetForm, label: string, opts: { keyboard?: 'number-pad' | 'decimal-pad'; hint?: string; placeholder?: string } = {}) => (
    <View style={{ gap: space.xs }}>
      <Field
        label={label}
        value={form![key]}
        onChangeText={edit(key)}
        keyboardType={opts.keyboard ?? 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={opts.placeholder}
        returnKeyType="done"
        editable={!busy}
        error={!!errors[key]}
      />
      {errors[key] ? <Text style={{ ...type.subhead, color: c.danger }}>{errors[key]}</Text> : opts.hint ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{opts.hint}</Text> : null}
    </View>
  );

  return (
    <Screen title="Anki options" footer={preset && form ? <Button label="Save" onPress={save} disabled={!changed} busy={busy} /> : undefined}>
      {!preset || !form ? <Loading error={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" {...scrollProps}>
          <Help>{presetIntro(preset.presetName)}</Help>
          <SectionTitle>Daily limits</SectionTitle>
          <Card>
            {field('newPerDay', 'New cards per day', { keyboard: 'number-pad' })}
            {field('reviewsPerDay', 'Maximum reviews per day', { keyboard: 'number-pad' })}
          </Card>
          <SectionTitle>Steps</SectionTitle>
          <Card>
            {field('learnSteps', 'Learning steps', { placeholder: 'e.g. 1m 10m' })}
            {field('relearnSteps', 'Relearning steps', { placeholder: 'e.g. 10m', hint: 'Use s, m, h or d after each number. Leave empty for no steps.' })}
          </Card>
          <SectionTitle>Scheduling</SectionTitle>
          <Card>
            {field('maxInterval', 'Maximum interval (days)', { keyboard: 'number-pad' })}
            {field('desiredRetention', 'Desired retention', {
              keyboard: 'decimal-pad',
              hint: `Between ${RETENTION_MIN.toFixed(2)} and ${RETENTION_MAX.toFixed(2)}. Cards already scheduled keep their dates until their next review.`,
            })}
          </Card>
          <SectionTitle>{preset.decks.length === 1 ? 'Applies to 1 deck' : `Applies to ${preset.decks.length} decks`}</SectionTitle>
          <Card>
            {preset.decks.map((d) => {
              const note = ownValuesNote(d.own);
              return (
                <View key={d.name} style={{ gap: 2 }}>
                  <Text style={{ ...type.subhead, color: c.text }}>{d.name}</Text>
                  {note ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{note}</Text> : null}
                </View>
              );
            })}
          </Card>
        </ScrollView>
      )}
    </Screen>
  );
}
