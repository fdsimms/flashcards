import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { failureText } from '../core/failure';
import { autoBackupList, AUTO_BACKUP_KEEP, AUTO_BACKUP_MINUTES } from '../db/autoBackup';
import { autoBackupFiles, onAutoBackupsChanged, saveAutoBackup, useAutoBackupOn } from './autoBackup';
import { Group, Help, NavRow, SectionTitle, SwitchRow } from './kit';
import { space } from './theme';

/**
 * Backup's automatic backups: the switch, and the ones kept on this iPhone, newest first. Tapping
 * one hands it to `onRestore`, which asks before restoring (Backup.tsx, `restoreAutomatic`).
 */
export function AutoBackups({ dayStartsAtHour, onRestore, disabled }: {
  dayStartsAtHour: number | undefined;
  onRestore: (name: string, label: string) => void;
  /** A backup or restore is running. */
  disabled: boolean;
}) {
  const on = useAutoBackupOn();
  const [files, setFiles] = useState<ReturnType<typeof autoBackupFiles>>([]);
  useEffect(() => {
    const read = () => { try { setFiles(autoBackupFiles()); } catch { setFiles([]); } };
    read();
    return onAutoBackupsChanged(read);
  }, []);

  const turn = async (next: boolean) => {
    try {
      await saveAutoBackup(next);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  const list = dayStartsAtHour === undefined ? { rows: [] } : autoBackupList(files, new Date(), dayStartsAtHour);
  const keep = `Franki keeps the latest ${AUTO_BACKUP_KEEP.latest}, then one a day for ${AUTO_BACKUP_KEEP.daily} days, one a week for ${AUTO_BACKUP_KEEP.weekly} weeks and one a month for ${AUTO_BACKUP_KEEP.monthly} months.`;

  return (
    <View style={{ gap: space.m }}>
      <Group>
        <SwitchRow
          first
          label="Back up automatically"
          hint={`Every ${AUTO_BACKUP_MINUTES} minutes while Franki is open, a copy is kept on this iPhone.`}
          value={!!on}
          onValueChange={turn}
        />
      </Group>
      {list.rows.length ? (
        <>
          <SectionTitle>On this iPhone</SectionTitle>
          <Group accessibilityRole="list">
            {list.rows.map((r, i) => (
              <NavRow key={r.name} first={i === 0} label={r.label} detail={r.size} disabled={disabled} onPress={() => onRestore(r.name, r.label)} />
            ))}
          </Group>
          <View style={{ paddingHorizontal: space.xs }}>
            <Help>
              {list.summary} {keep} They hold your decks, cards and review history, but not images or sounds. If you lose this
              iPhone you lose them too, so use Back up now to keep one somewhere else.
            </Help>
          </View>
        </>
      ) : null}
    </View>
  );
}
