import React from 'react';
import { useApp } from '../ui/AppContext';
import { FuriganaSettings } from '../ui/FuriganaSettings';

/** Settings > Furigana: where a Japanese word's reading is set above its kanji. */
export default function FuriganaRoute() {
  const { repo, wanikani } = useApp();
  return <FuriganaSettings repo={repo} wanikaniOn={!!wanikani.on} />;
}
