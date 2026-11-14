import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { Settings } from '../ui/Settings';

export default function SettingsRoute() {
  const router = useRouter();
  const { repo, backup, reader, wanikani } = useApp();
  return (
    <Settings
      repo={repo}
      backupText={backup?.text}
      readerOn={!!reader.api}
      onRead={() => router.push('/read-settings')}
      wanikaniOn={!!wanikani.on}
      onWaniKani={() => router.push('/wanikani-settings')}
      onAnki={() => router.push('/anki')}
      onBackup={() => router.push('/backup')}
      onVoices={() => router.push('/voices')}
      onReminder={() => router.push('/reminder')}
      onVacation={() => router.push('/vacation')}
      onSpeaking={() => router.push('/speaking')}
    />
  );
}
