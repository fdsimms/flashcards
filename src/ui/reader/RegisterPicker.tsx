import React from 'react';
import { REGISTER_LEVELS, registerHelp, type RegisterLevel } from '../../reader/registerLevel';
import { Help, Segments } from '../kit';

/**
 * A cram's or a scene's own register: Default follows Settings (`own` undefined), the rest choose.
 * `settings` is the register Settings holds, undefined while it isn't known (offline, an older server).
 */
export function RegisterPicker({ own, settings, onChange }: {
  own: RegisterLevel | undefined;
  settings: RegisterLevel | undefined;
  onChange: (own: RegisterLevel | undefined) => void;
}) {
  return (
    <>
      <Segments<RegisterLevel | 'default'>
        options={[{ value: 'default', label: 'Default' }, ...REGISTER_LEVELS.map((l) => ({ value: l.value, label: l.label }))]}
        value={own ?? 'default'}
        onChange={(value) => onChange(value === 'default' ? undefined : value)}
      />
      <Help>{registerHelp(own, settings)}</Help>
    </>
  );
}
