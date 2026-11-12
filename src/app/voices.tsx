import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { Voices } from '../ui/Voices';

/** Settings > Voices: each language's text-to-speech voice and speed. */
export default function VoicesRoute() {
  const router = useRouter();
  const { repo } = useApp();
  return <Voices repo={repo} onLanguage={(lang) => router.push({ pathname: '/voice-language', params: { lang } })} />;
}
