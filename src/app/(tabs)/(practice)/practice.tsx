import { useRouter } from 'expo-router';
import React from 'react';
import { Practice } from '../../../ui/Practice';

/** The Practice tab: the list of tools. A tool opens over the tab bar, like Review. */
export default function PracticeRoute() {
  const router = useRouter();
  return <Practice onOpen={(tool) => router.push({ pathname: '/tool', params: { id: tool.id } })} />;
}
