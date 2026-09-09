import { Suspense } from 'react';
import Composer from '@/components/Composer';
import TopBar from '@/components/TopBar';

export default function Home() {
  return (
    <>
      <TopBar>
        <span className="text-[13px] text-ink-2">runway model</span>
      </TopBar>

      <main className="flex w-full flex-1 flex-col">
        <div className="flex min-h-[calc(100vh-57px)] w-full items-center justify-center px-10 py-8">
          <div className="w-full max-w-[760px]">
            <Suspense>
              <Composer />
            </Suspense>
          </div>
        </div>

        {/*
          Not in the Figma file, which centres the composer on an otherwise empty screen. It
          sits below the fold so that first screen is untouched, and it answers the "just
          another AI wrapper" objection by showing the arithmetic rather than claiming
          anything about it (SPEC 11).
        */}
        <section className="mx-auto w-full max-w-[760px] px-10 pb-20">
          <div className="border-t border-line pt-8">
            <h2 className="text-[11px] font-semibold tracking-[1.1px] text-ink-3">
              WHERE THE NUMBERS COME FROM
            </h2>
            <p className="mt-3 max-w-[640px] text-[15px] leading-[24px] text-ink-2">
              Claude reads your sentence and nothing else. It never projects, never forecasts,
              never computes a number. This is the entire model, run once per month:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-[10px] border border-line bg-surface p-4 text-[13px] leading-[22px] text-ink-2">
              <code>{`customers = customers * (1 - churn) + newPerMonth
revenue   = customers * price
cash      = cash + revenue - burn`}</code>
            </pre>
            <p className="mt-3 max-w-[640px] text-[13px] leading-[21px] text-ink-3">
              Churn hits the customers you already had before the month&apos;s new signups land,
              so someone who joined this month cannot leave this month. That is a choice, not a
              fact, and it moves the curve. It stays visible on every model.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
