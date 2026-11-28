import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadWrite } from '../ui/reader/ReadWrite';
import { Loading, Screen } from '../ui/kit';
import { leaveScreen } from '../ui/leaveScreen';
import { shareInbox } from '../ui/shareInbox';
import { READ_PATH } from '../ui/tabPaths';

/** Having a series, dialogue or story written, pasting a text of your own, or adding a video, from the home's + button, as a sheet. `kind` skips the choice. */
export default function ReadWriteRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { kind, shared: sharedId } = useLocalSearchParams<{ kind?: string; shared?: string }>();
  // Text shared from another app, opened here by useShareInbox: kept until it's added or cancelled.
  const shared = shareInbox.get(sharedId);
  if (!reader.api) return <Redirect href="/read-settings" />;
  // Your own text needs the reader's language, so a share opened at launch waits for its settings.
  if ((kind === 'own' || kind === 'video') && !reader.settings) return <Screen title="Your own text" largeTitle={false}><Loading /></Screen>;
  return (
    <ReadWrite
      api={reader.api}
      language={reader.settings?.language}
      kind={kind === 'series' || kind === 'dialogue' || kind === 'story' || kind === 'own' || kind === 'video' ? kind : undefined}
      shared={shared}
      onDone={() => {
        if (shared) shareInbox.remove(shared.id);
        leaveScreen(router, READ_PATH);
      }}
    />
  );
}
