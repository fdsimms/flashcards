import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadSettings } from '../ui/reader/ReadSettings';

/** Turning Read & Listen on (its passphrase) or off, and sharing the deck list's counts for dundundun. */
export default function ReadSettingsRoute() {
  const router = useRouter();
  const { reader } = useApp();
  return (
    <ReadSettings
      syncServer={reader.server}
      signedIn={!!reader.api}
      notice={reader.notice}
      onSignedIn={reader.signedIn}
      onSignOut={reader.signOut}
      onSyncSetup={() => router.push('/sync')}
      shareCounts={reader.shareCounts}
      onShareCounts={reader.setShareCounts}
    />
  );
}
