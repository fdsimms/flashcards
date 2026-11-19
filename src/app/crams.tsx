import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramList } from '../ui/cram/CramList';

/** Practice, Cram: every cram (src/core/cram.ts). Plan the next lesson asks Read & Listen for themes, so it's there only while that's on. */
export default function CramsRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  return <CramList repo={repo} onPlan={reader.api ? () => router.push('/cram-themes') : undefined} />;
}
