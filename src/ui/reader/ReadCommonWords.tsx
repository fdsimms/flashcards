import React from 'react';
import type { CommonCount, Settings } from '../../reader/api';
import { COMMON_COUNTS, commonLabel, commonNamed, glossInfo, spokenLanguage } from '../../reader/languages';
import { Help, Select } from '../kit';

/**
 * How many of the current language's most common words count as known, besides its deck
 * (docs/read-and-listen/architecture.md, Languages). Thai counts only its deck, so it has none, and a
 * server older than the setting doesn't send it.
 */
export function CommonWords({ settings, onChange }: { settings: Settings; onChange: (count: CommonCount) => void }) {
  const spoken = spokenLanguage(settings.language);
  const count = spoken ? settings.common?.[spoken] : undefined;
  if (count === undefined) return null;
  const name = glossInfo(settings.language).name;
  // Japanese also counts the vocabulary learned in WaniKani, when the server has its token.
  const deck = settings.language === 'ja' ? 'your Japanese deck and WaniKani' : `your ${name} deck`;
  return (
    <>
      <Select
        label="Common words counted as known"
        options={COMMON_COUNTS.map(commonLabel)}
        value={commonLabel(count)}
        onChange={(label) => {
          const next = commonNamed(label);
          if (next !== undefined && next !== count) onChange(next);
        }}
      />
      <Help>
        {count === 0
          ? `Only words from ${deck} count as known. Choose a number if texts feel too hard to write from the deck alone.`
          : `Texts can use the ${commonLabel(count)} most common ${name} words, in all their forms, as well as ${deck}. Choose fewer if texts feel too hard. Applies to texts written from now on.`}
      </Help>
    </>
  );
}
