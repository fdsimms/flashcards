import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { NoteTypeEditor } from '../ui/NoteTypeEditor';

/** One note type's card templates and styling (`?name=Basic`), from Note types. */
export default function NoteTypeRoute() {
  const router = useRouter();
  const { repo } = useApp();
  const { name } = useLocalSearchParams<{ name: string }>();
  return <NoteTypeEditor repo={repo} name={name ?? ''} onClose={() => router.back()} />;
}
