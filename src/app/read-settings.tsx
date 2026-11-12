import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadSettings } from '../ui/ReadSettings';

/** Turning Read & Listen on (its passphrase) or off. */
export default function ReadSettingsRoute() {
  const router = useRouter();
  const { readerApi, readerServer, readerNotice, signedInToReader, signOutOfReader } = useApp();
  return (
    <ReadSettings
      syncServer={readerServer}
      signedIn={!!readerApi}
      notice={readerNotice}
      onSignedIn={signedInToReader}
      onSignOut={signOutOfReader}
      onSyncSetup={() => router.push('/sync')}
    />
  );
}
