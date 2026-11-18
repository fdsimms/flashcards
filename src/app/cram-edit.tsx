import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramEditor } from '../ui/cram/CramEditor';

/** A new cram, or the one named by `id` to edit, as a sheet. */
export default function CramEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <CramEditor repo={useApp().repo} id={id || undefined} />;
}
