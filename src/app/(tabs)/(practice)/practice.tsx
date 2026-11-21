import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { studiedLanguages } from '../../../tools/tools';
import { Practice } from '../../../ui/Practice';
import { useApp } from '../../../ui/AppContext';

/** The Practice tab: the list of tools. A tool opens over the tab bar, like Review. */
export default function PracticeRoute() {
  const router = useRouter();
  const { reader, repo, decks } = useApp();
  const studied = useMemo(() => studiedLanguages(decks), [decks]);
  return <Practice readerApi={reader.api} repo={repo} studied={studied} onOpen={(tool) => router.push({ pathname: '/tool', params: { id: tool.id } })} onCram={() => router.push('/crams')} onSettings={() => router.push({ pathname: '/settings-page', params: { page: 'practice' } })} />;
}
