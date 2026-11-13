import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { DEFAULT_PRIORITY_DAYS, DEFAULT_PRIORITY_PERCENT, MAX_PRIORITY_DAYS, parsePriorityNumber, prioritySettings } from '../core/priority';
import type { DeckSettings } from '../core/types';
import { Card, Field, Help, SectionTitle, SwitchRow } from './kit';
import { space, type, useTheme } from './theme';

/**
 * Deck options for "tagged cards first" (`prioritySettings`). It applies to the deck and its
 * subdecks unless a subdeck sets its own, so what's shown is what applies here. A number is saved
 * as soon as it's valid, so leaving the screen never drops an edit.
 */
export function DeckPriorityOptions({ deck, all, onChange }: {
  deck: string;
  /** Every deck's settings, this deck's as it is now. */
  all: Map<string, DeckSettings>;
  onChange: (patch: DeckSettings) => void;
}) {
  const c = useTheme();
  const p = prioritySettings(deck, all);
  const [days, setDays] = useState(String(p.days));
  const [percent, setPercent] = useState(String(p.percent));
  const [errors, setErrors] = useState<{ days?: string; percent?: string }>({});

  const number = (key: 'days' | 'percent', text: string, min: number, max: number, what: string) => {
    (key === 'days' ? setDays : setPercent)(text);
    const parsed = parsePriorityNumber(text, min, max, what);
    setErrors((e) => ({ ...e, [key]: 'error' in parsed ? parsed.error : undefined }));
    if ('value' in parsed) onChange(key === 'days' ? { priorityDays: parsed.value } : { priorityPercent: parsed.value });
  };

  return (
    <>
      <SectionTitle>Tagged cards first</SectionTitle>
      <Card>
        <SwitchRow first label="Study tagged cards first" value={p.on} onValueChange={(v) => onChange({ priorityFirst: v })} />
        <Help>
          New cards with this tag come before the rest of the deck's new cards. A card stops coming first once you've studied it,
          or {p.days === 1 ? '1 day' : `${p.days} days`} after Franki first saw the tag on it, whichever happens first. They never
          take more than {p.percent}% of the day's new cards (rounded up, so at least 1), and they count against the same daily
          limit. Reviews are never moved.
        </Help>
        {p.on ? (
          <View style={{ gap: space.m }}>
            <Field label="Tag" value={p.tag} onChangeText={(v) => onChange({ priorityTag: v })} autoCapitalize="none" autoCorrect={false} placeholder="italki" />
            {p.tag ? null : <Text style={{ ...type.subhead, color: c.warning }}>Enter a tag. Nothing comes first until you do.</Text>}
            <Field label="First for (days)" value={days} onChangeText={(v) => number('days', v, 1, MAX_PRIORITY_DAYS, 'Days')} keyboardType="number-pad" error={!!errors.days} placeholder={String(DEFAULT_PRIORITY_DAYS)} />
            {errors.days ? <Text style={{ ...type.subhead, color: c.danger }}>{errors.days}</Text> : null}
            <Field label="At most (% of new cards)" value={percent} onChangeText={(v) => number('percent', v, 1, 100, 'The percentage')} keyboardType="number-pad" error={!!errors.percent} placeholder={String(DEFAULT_PRIORITY_PERCENT)} />
            {errors.percent ? <Text style={{ ...type.subhead, color: c.danger }}>{errors.percent}</Text> : null}
          </View>
        ) : null}
      </Card>
    </>
  );
}
