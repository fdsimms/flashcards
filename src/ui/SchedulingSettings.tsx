import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, useColorScheme, View } from 'react-native';
import { saveCollectionPrefs } from '../anki/collectionPrefsService';
import { NO_COLLECTION } from '../anki/noteService';
import { parseMinutes, prefsOf, type CollectionPrefs } from '../core/collectionPrefs';
import { failureText } from '../core/failure';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { haptic } from './haptics';
import { Card, Field, Group, Help, Loading, Screen, Section, SECTION_GAP, SwitchRow } from './kit';
import { MIN_TAP, readable, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourText = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

/**
 * Settings, Decks and cards, Scheduling: Anki's collection-wide scheduling preferences (the next
 * day's start, learn ahead, the session time limit, how daily limits add up, the load balancer),
 * written into the Anki collection (`saveCollectionPrefs`) so every device follows after sync.
 * Each saves as it's changed; a number field saves when it's left. `onSaved` recounts the decks.
 */
export function SchedulingSettings({ repo, onSaved }: { repo: Repo & AnkiLink; onSaved: () => void }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const [prefs, setPrefs] = useState<CollectionPrefs>();
  const [hasCollection, setHasCollection] = useState<boolean>();
  const [text, setText] = useState({ learnAhead: '', timeLimit: '' });
  const [errors, setErrors] = useState<{ learnAhead?: string; timeLimit?: string }>({});
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  useEffect(() => {
    Promise.all([repo.collectionSettings(), repo.keptCollection()]).then(([cs, kept]) => {
      if (!live.current) return;
      const p = prefsOf(cs);
      setPrefs(p);
      setText({ learnAhead: String(p.learnAheadMinutes), timeLimit: String(p.timeLimitMinutes) });
      setHasCollection(!!kept);
    }).catch(() => undefined);
  }, [repo]);

  // Saved first, then shown, so the screen never shows a setting that isn't stored.
  const save = async (change: Partial<CollectionPrefs>) => {
    try {
      const next = prefsOf(await saveCollectionPrefs(repo, change));
      if (!live.current) return;
      setPrefs(next);
      onSaved();
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  const saveMinutes = (field: 'learnAhead' | 'timeLimit') => {
    if (!prefs) return;
    const parsed = parseMinutes(text[field]);
    if ('error' in parsed) { setErrors((e) => ({ ...e, [field]: parsed.error })); return; }
    const key = field === 'learnAhead' ? 'learnAheadMinutes' : 'timeLimitMinutes';
    setText((t) => ({ ...t, [field]: String(parsed.minutes) }));
    if (parsed.minutes !== prefs[key]) void save({ [key]: parsed.minutes });
  };

  const minutesField = (field: 'learnAhead' | 'timeLimit', label: string, hint: string) => (
    <View style={{ gap: space.xs }}>
      <Field
        label={label}
        value={text[field]}
        onChangeText={(t) => { setText((x) => ({ ...x, [field]: t })); setErrors((e) => ({ ...e, [field]: undefined })); }}
        onEndEditing={() => saveMinutes(field)}
        keyboardType="number-pad"
        returnKeyType="done"
        error={!!errors[field]}
      />
      {errors[field]
        ? <Text style={{ ...type.subhead, color: c.danger }}>{errors[field]}</Text>
        : <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text>}
    </View>
  );

  return (
    <Screen title="Scheduling">
      {!prefs || hasCollection === undefined ? <Loading /> : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl + bottomPadding, gap: SECTION_GAP }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" {...scrollProps}>
          {!hasCollection ? <Help>{NO_COLLECTION}</Help> : (
            <>
              <Help>These apply to every deck, and to Anki on every device that syncs with this collection.</Help>
              <Section title="Study day" footer={<Help>Studying before this hour counts toward the day before.</Help>}>
                <Group>
                  <View style={{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l }}>
                    <Text style={{ ...type.body, color: c.text, flex: 1 }}>Next day starts at</Text>
                    <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
                      <Picker
                        label="Next day starts at"
                        modifiers={[pickerStyle('menu')]}
                        selection={prefs.dayStartsAtHour}
                        onSelectionChange={(h: number) => { if (h === prefs.dayStartsAtHour) return; haptic.select(); void save({ dayStartsAtHour: h }); }}
                      >
                        {HOURS.map((h) => <SwiftText key={h} modifiers={[tag(h)]}>{hourText(h)}</SwiftText>)}
                      </Picker>
                    </Host>
                  </View>
                </Group>
              </Section>
              <Section title="Reviews">
                <Card>
                  {minutesField('learnAhead', 'Learn ahead limit (minutes)', 'When nothing else is left, learning cards due within this many minutes are shown early.')}
                  {minutesField('timeLimit', 'Session time limit (minutes)', 'Say when a session has gone on this long. 0 turns it off.')}
                </Card>
              </Section>
              <Section title="Daily limits">
                <Group>
                  <SwitchRow
                    first
                    label="New cards ignore the review limit"
                    hint="Otherwise new cards studied today also count toward the review limit."
                    value={prefs.newCardsIgnoreReviewLimit}
                    onValueChange={(on) => void save({ newCardsIgnoreReviewLimit: on })}
                  />
                  <SwitchRow
                    label="Apply all parent limits"
                    hint="Limits of the decks above the one you open also apply."
                    value={prefs.applyAllParentLimits}
                    onValueChange={(on) => void save({ applyAllParentLimits: on })}
                  />
                  <SwitchRow
                    label="Load balancer"
                    hint="Spread reviews out by picking the least busy day each interval allows."
                    value={prefs.loadBalancer}
                    onValueChange={(on) => void save({ loadBalancer: on })}
                  />
                </Group>
              </Section>
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
