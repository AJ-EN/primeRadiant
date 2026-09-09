import { Suspense } from 'react';
import ModelClient from '@/components/ModelClient';

/** The model, the shared view and the fork are three states of this one page, not three routes. */
export default function ModelPage() {
  return (
    <Suspense>
      <ModelClient />
    </Suspense>
  );
}
