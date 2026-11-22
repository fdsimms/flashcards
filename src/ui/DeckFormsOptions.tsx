import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { FORM_PROMPT_CHOICES, formsSettings } from '../core/forms';
import { LOOKALIKE_DAY_CHOICES, lookalikeSettings } from '../core/lookalikes';
import { aspectCheckOn } from '../core/aspectCheck';
import type { DeckSettings } from '../core/types';
import { Group, Help, NavRow, SectionTitle, Segments, SwitchRow } from './kit';
import { space } from './theme';

/**
 * Deck options for forms practice, verb aspect and lookalike words. They apply to the deck and its subdecks
 * unless a subdeck sets its own, so what's shown is what applies here (`formsSettings`,
 * `lookalikeSettings`), and a change is saved as this deck's own.
 */
export function DeckFormsOptions({ deck, formsApply, aspectApplies, all, onChange }: {
  deck: string;
  /** Whether any note in the deck lists forms (`deckHasForms`); Forms practice is hidden without. */
  formsApply: boolean;
  /** Whether the deck has Russian or Polish notes (`deckHasAspectLanguage`); the verb aspect setting is hidden without. */
  aspectApplies: boolean;
  /** Every deck's settings, this deck's as it is now. */
  all: Map<string, DeckSettings>;
  onChange: (patch: DeckSettings) => void;
}) {
  const router = useRouter();
  const forms = formsSettings(deck, all);
  const look = lookalikeSettings(deck, all);
  return (
    <>
      {formsApply ? (
        <>
          <SectionTitle>Forms practice</SectionTitle>
          <Group>
            <SwitchRow first label="Suggest forms practice" value={forms.suggest} onValueChange={(v) => onChange({ suggestForms: v })} />
            <NavRow label="Practice forms" detail="One pattern across the words you've studied" onPress={() => router.push({ pathname: '/forms-practice', params: { deck } })} />
            <NavRow label="Practice history" detail="Forms you miss, and answers you mix up" onPress={() => router.push({ pathname: '/forms-history', params: { deck } })} />
          </Group>
          <Help>
            Suggested on a card's answer side for a word new this week, one whose forms you missed last time, or one you
            haven't practiced in a month.
          </Help>
          <View style={{ gap: space.s }}>
            <SectionTitle>Prompts each time</SectionTitle>
            <Segments<number>
              options={FORM_PROMPT_CHOICES.map((n) => ({ value: n, label: String(n), accessibilityLabel: `${n} prompts` }))}
              value={forms.prompts}
              onChange={(n) => onChange({ formPrompts: n })}
            />
          </View>
        </>
      ) : null}

      {aspectApplies ? (
        <>
          <SectionTitle>Verb aspect</SectionTitle>
          <Group>
            <SwitchRow first label="Ask imperfective or perfective" value={aspectCheckOn(deck, all)} onValueChange={(v) => onChange({ aspectCheck: v })} />
          </Group>
          <Help>
            On the front of a Russian or Polish verb tagged imperfective or perfective, two buttons ask which it is. You can skip
            them and tap Show answer. A wrong pick only outlines Hard when you rate the card.
          </Help>
        </>
      ) : null}

      <SectionTitle>Lookalike words</SectionTitle>
      <Group>
        <SwitchRow first label="Keep lookalikes apart" value={look.keepApart} onValueChange={(v) => onChange({ keepLookalikesApart: v })} />
        <SwitchRow label="Offer to show a card again sooner" value={look.offerSooner} onValueChange={(v) => onChange({ offerSooner: v })} />
      </Group>
      <Help>
        After you see a word, cards for words that look like it (esperar, espero, esperanza) wait, so one doesn't give away the
        answer to the next. Cards you're still learning don't wait. When a lookalike got through anyway,
        the answer side offers to bring the card back sooner. Anki may change that date later, when it recalculates its own
        schedule.
      </Help>
      {look.keepApart ? (
        <View style={{ gap: space.s }}>
          <SectionTitle>Wait at least</SectionTitle>
          <Segments<number>
            options={LOOKALIKE_DAY_CHOICES.map((d) => ({ value: d, label: d === 1 ? 'Until tomorrow' : `${d} days` }))}
            value={look.days}
            onChange={(d) => onChange({ lookalikeDays: d })}
          />
        </View>
      ) : null}
      <Help>Forms practice and lookalike settings apply to this deck and its subdecks, unless a subdeck sets its own.</Help>
    </>
  );
}
