import { useRouter } from 'expo-router';
import React from 'react';
import { Practice } from '../../../ui/Practice';
import { useApp } from '../../../ui/AppContext';

/** The Practice tab: the list of tools. A tool opens over the tab bar, like Review. */
export default function PracticeRoute() {
  const router = useRouter();
  const { reader } = useApp();
  return <Practice readerApi={reader.api} onOpen={(tool) => router.push({ pathname: '/tool', params: { id: tool.id } })} />;
}
