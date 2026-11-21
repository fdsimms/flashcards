import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { NoteTypes } from '../ui/NoteTypes';

/** Settings > Decks and cards > Note types: the collection's note types. */
export default function NoteTypesRoute() {
  const router = useRouter();
  const { repo } = useApp();
  return <NoteTypes repo={repo} onOpen={(name) => router.push({ pathname: '/note-type', params: { name } })} />;
}
