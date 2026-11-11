import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { AnkiTransfer } from '../ui/AnkiTransfer';

export default function AnkiRoute() {
  const router = useRouter();
  const { repo, syncSettings } = useApp();
  return <AnkiTransfer repo={repo} syncOn={!!syncSettings?.enabled} onSyncSettings={() => router.push('/sync')} />;
}
