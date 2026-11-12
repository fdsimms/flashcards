import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import type { DrillRequest } from '../core/forms';
import { useApp } from '../ui/AppContext';
import { FormsDrill } from '../ui/FormsDrill';

/** A forms drill for the `request` parameter (a `DrillRequest` as JSON), from Review or forms practice. */
export default function FormsDrillRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const { request } = useLocalSearchParams<{ request: string }>();
  return <FormsDrill repo={repo} readerApi={reader.api} request={JSON.parse(request) as DrillRequest} onDone={() => router.back()} />;
}
