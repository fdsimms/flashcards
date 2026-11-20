import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import type { DrillRequest } from '../core/forms';
import { useApp } from '../ui/AppContext';
import { FormsDrill } from '../ui/FormsDrill';
import { leaveScreen } from '../ui/leaveScreen';
import { PRACTICE_PATH } from '../ui/tabPaths';

/** A forms drill for the `request` parameter (a `DrillRequest` as JSON), from Review or forms practice. */
export default function FormsDrillRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const { request } = useLocalSearchParams<{ request: string }>();
  return (
    <FormsDrill
      repo={repo}
      readerApi={reader.api}
      request={JSON.parse(request) as DrillRequest}
      onDone={() => leaveScreen(router, PRACTICE_PATH)}
      onOpenGrammar={reader.api ? (id) => router.push({ pathname: '/read-grammar-point', params: { id } }) : undefined}
    />
  );
}
