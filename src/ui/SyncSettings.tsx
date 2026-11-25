import React, { useRef, useState } from 'react';
import { Alert, ScrollView, Text, type TextInputInstance } from 'react-native';
import { syncErrorText, syncStatusText } from '../anki/sync/runSync';
import { signIn, turnOffSync } from '../anki/syncService';
import { failureText } from '../core/failure';
import type { AnkiLink, SyncSettings as Settings } from '../db/ankiLink';
import { Button, Card, Field, Help, MessageList, Screen, SECTION_GAP } from './kit';
import { space, type, useTheme, readable } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/**
 * Setting up sync with an Anki sync server, and syncing by hand. Off until signed in. Sync itself
 * (and its progress) belongs to the app (useSync), since it also runs when the app opens and closes.
 */
export function SyncSettings(props: {
  repo: AnkiLink;
  settings?: Settings;
  syncing: boolean;
  sync: () => Promise<string | undefined>;
  reload: () => Promise<void>;
}) {
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const c = useTheme();
  const s = props.settings;
  const [server, setServer] = useState(s?.server ?? '');
  const [user, setUser] = useState(s?.user ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [log, setLog] = useState<string[]>([]);
  const userField = useRef<TextInputInstance>(null);
  const passwordField = useRef<TextInputInstance>(null);

  // Return on the password field can land again while a sign-in runs; the button is disabled, it isn't.
  const signingIn = useRef(false);
  const submit = async () => {
    if (signingIn.current) return;
    if (!server.trim() || !user.trim() || !password) {
      setError('Fill in the server address, user name and password.');
      return;
    }
    signingIn.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await signIn(props.repo, server, user.trim(), password);
      setPassword('');
      await props.reload();
      const line = await props.sync();
      if (line) setLog((l) => [line, ...l]);
    } catch (e) {
      setError(syncErrorText(e));
    } finally {
      signingIn.current = false;
      setBusy(false);
    }
  };

  const syncNow = async () => {
    const line = await props.sync();
    if (line) setLog((l) => [line, ...l]);
  };

  const turnOff = () => Alert.alert(
    'Turn off sync?',
    'Franki stops syncing and forgets the sign-in. Your decks stay as they are, and answers given from now on wait until you turn sync back on.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn off', style: 'destructive', onPress: async () => {
          try {
            await turnOffSync(props.repo);
            await props.reload();
          } catch (e) {
            Alert.alert("Couldn't turn off sync", failureText(e, { next: 'Try again.' }));
          }
        },
      },
    ],
  );

  return (
    <Screen title="Sync">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding, gap: SECTION_GAP }} keyboardShouldPersistTaps="handled" {...scrollProps}>
        {s?.enabled ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Syncing with {s.server.replace(/^https?:\/\//, '').replace(/\/$/, '')}</Text>
            <Text style={{ ...type.body, color: s.lastError ? c.warning : c.textSecondary }}>
              Signed in as {s.user}. {syncStatusText(s, new Date())}
            </Text>
            <Help>
              Franki syncs when you open it, when you finish studying a deck, and when you leave the app, except in the middle of studying, so Undo still works when you come back. Images and sounds
              added in Anki come down with each sync.
            </Help>
            <Button label="Sync now" onPress={syncNow} busy={props.syncing} />
            <Button label="Turn off sync" variant="destructive" onPress={turnOff} disabled={props.syncing} />
          </Card>
        ) : (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Sync with your Anki server</Text>
            <Help>
              Franki syncs with an Anki sync server you run yourself, the same one Anki on your computer and AnkiMobile sync
              with. It can't sync with AnkiWeb. Set one up from your computer with the steps in the server folder of Franki's repository.
            </Help>
            <Field label="Server address" value={server} onChangeText={setServer} placeholder="e.g. anki.example.com"
              autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" error={!!error && !server.trim()}
              returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => userField.current?.focus()} />
            <Field ref={userField} label="User name" value={user} onChangeText={setUser} autoCapitalize="none" autoCorrect={false}
              textContentType="username" error={!!error && !user.trim()}
              returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordField.current?.focus()} />
            <Field ref={passwordField} label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password"
              onSubmitEditing={submit} returnKeyType="go" error={!!error && !password} />
            {error ? <Text style={{ ...type.subhead, color: c.danger }}>{error}</Text> : null}
            <Help>Franki doesn't store your password. It keeps a sign-in key in the iPhone's Keychain.</Help>
            <Button label="Sign in and sync" onPress={submit} busy={busy || props.syncing} />
          </Card>
        )}
        <MessageList lines={log} />
      </ScrollView>
    </Screen>
  );
}
