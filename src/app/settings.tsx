import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { Settings } from '../ui/Settings';

export default function SettingsRoute() {
  const router = useRouter();
  const { repo, backup } = useApp();
  return (
    <Settings
      repo={repo}
      backupText={backup?.text}
      onAnki={() => router.push('/anki')}
      onStats={() => router.push('/stats')}
      onBackup={() => router.push('/backup')}
    />
  );
}
