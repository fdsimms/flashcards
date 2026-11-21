import React, { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { DEFAULT_PRIORITY_DAYS, DEFAULT_PRIORITY_PERCENT, MAX_PRIORITY_DAYS, parsePriorityNumber, priorityMatchCount, prioritySettings, tagCounts } from '../core/priority';
import type { DeckSettings, Note } from '../core/types';
import { Card, Field, Group, Help, SectionTitle, SwitchRow } from './kit';
import { TagTokenField } from './TagTokenField';
import { type, useTheme } from './theme';

/**
 * Deck options for "tagged cards first" (`prioritySettings`). It applies to the deck and its
 * subdecks unless a subdeck sets its own, so what's shown is what applies here. A number is saved
 * as soon as it's valid, so leaving the screen never drops an edit.
 */
export function DeckPriorityOptions({ deck, all, notes, onChange }: {
  deck: string;
  /** Every note, for suggesting tags and counting what the tags match. */
  notes: Note[];
  /** Every deck's settings, this deck's as it is now. */
  all: Map<string, DeckSettings>;
  onChange: (patch: DeckSettings) => void;
}) {
  const c = useTheme();
  const p = prioritySettings(deck, all);
  const counts = useMemo(() => tagCounts(notes), [notes]);
  const matched = priorityMatchCount(notes, deck, p.tags);
  const [days, setDays] = useState(String(p.days));
  const [percent, setPercent] = useState(String(p.percent));
  const [errors, setErrors] = useState<{ days?: string; percent?: string }>({});

  const number = (key: 'days' | 'percent', text: string, min: number, max: number) => {
    (key === 'days' ? setDays : setPercent)(text);
    const parsed = parsePriorityNumber(text, min, max);
    setErrors((e) => ({ ...e, [key]: 'error' in parsed ? parsed.error : undefined }));
    if ('value' in parsed) onChange(key === 'days' ? { priorityDays: parsed.value } : { priorityPercent: parsed.value });
  };

  return (
    <>
      <SectionTitle>Tagged cards first</SectionTitle>
      <Group>
        <SwitchRow first label="Study tagged cards first" value={p.on} onValueChange={(v) => onChange({ priorityFirst: v })} />
      </Group>
      <Help>
        New cards with any of these tags come before the deck's other new cards, until you've studied them or for the days
        set below. They take up to the share of new cards set below, within the same daily limit. Reviews keep their order.
      </Help>
      {p.on ? (
        <Card>
          <TagTokenField label="Tags" tags={p.tags} onChange={(tags) => onChange({ priorityTag: tags.join(' ') })} counts={counts} placeholder="Add a tag" />
          <Text style={{ ...type.subhead, color: p.tags.length && matched ? c.textSecondary : c.warningInk }}>
            {!p.tags.length ? 'Add a tag. Nothing comes first until you do.'
              : matched ? `${matched} ${matched === 1 ? 'note' : 'notes'} in this deck ${matched === 1 ? 'has' : 'have'} ${p.tags.length === 1 ? 'this tag' : 'these tags'}.`
              : `No notes in this deck have ${p.tags.length === 1 ? 'this tag' : 'these tags'}. Nothing comes first until some do.`}
          </Text>
          <Field label="First for (days)" value={days} onChangeText={(v) => number('days', v, 1, MAX_PRIORITY_DAYS)} keyboardType="number-pad" error={!!errors.days} placeholder={String(DEFAULT_PRIORITY_DAYS)} />
          {errors.days ? <Text style={{ ...type.subhead, color: c.danger }}>{errors.days}</Text> : null}
          <Field label="At most (% of new cards)" value={percent} onChangeText={(v) => number('percent', v, 1, 100)} keyboardType="number-pad" error={!!errors.percent} placeholder={String(DEFAULT_PRIORITY_PERCENT)} />
          {errors.percent ? <Text style={{ ...type.subhead, color: c.danger }}>{errors.percent}</Text> : null}
        </Card>
      ) : null}
    </>
  );
}
