import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramList } from '../ui/cram/CramList';

/** Practice, Cram: every cram (src/core/cram.ts). */
export default function CramsRoute() {
  return <CramList repo={useApp().repo} />;
}
