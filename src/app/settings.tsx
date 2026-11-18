import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { Settings } from '../ui/Settings';

export default function SettingsRoute() {
  const router = useRouter();
  const { repo, backup, wanikani } = useApp();
  return (
    <Settings
      repo={repo}
      backupText={backup?.text}
      wanikaniOn={!!wanikani.on}
      onWaniKani={() => router.push('/wanikani-settings')}
      onAnki={() => router.push('/anki')}
      onBackup={() => router.push('/backup')}
      onVoices={() => router.push('/voices')}
      onSpeaking={() => router.push('/speaking')}
      onFont={() => router.push('/app-font')}
      onPage={(page) => router.push({ pathname: '/settings-page', params: { page } })}
      onOpen={(route) => router.push(route as never)}
    />
  );
}
