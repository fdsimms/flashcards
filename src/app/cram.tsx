import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramPage } from '../ui/cram/CramPage';

/** A cram's page, by its `id`. Read a text goes to Read & Listen's shelf with the words to practice, as Review's does. */
export default function CramRoute() {
  const router = useRouter();
  const { repo, reader, openNoteEditor, sync } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <CramPage
      repo={repo}
      id={id}
      readerApi={reader.api}
      serverRegister={reader.settings?.register}
      onEditNote={(noteId, onClose) => openNoteEditor({ noteId }, () => onClose())}
      onRead={async (language, words) => {
        // Synced first, so the server knows the words as they are now.
        await sync({ afterRunning: true });
        router.dismissTo({ pathname: '/read', params: { practice: JSON.stringify({ language, words }) } });
      }}
    />
  );
}
