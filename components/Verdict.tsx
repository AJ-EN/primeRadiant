'use client';

/**
 * The verdict headline is the largest element on the page — larger than the chart.
 * "You run out of cash in month 6" is screenshot-able; a cash curve is not.
 *
 * The closed-form facts a founder cannot do in their head — the ceiling, the breakeven
 * month, the size of the gap — are carried in the body sentence rather than a stat strip,
 * so the whole verdict reads as one claim someone can disagree with.
 */
import type { ReactNode } from 'react';
import type { Derived, Params } from '@/lib/engine';
import { count, money, percent } from '@/lib/format';
import { headline } from '@/lib/verdict';

type Props = { derived: Derived; params: Params; months: number; isFork?: boolean };

function body(d: Derived, p: Params, months: number): ReactNode {
  switch (d.outcome) {
    case 'dies_before_arrival': {
      const gap =
        d.breakevenMonth !== null && d.runoutMonth !== null
          ? d.breakevenMonth - d.runoutMonth
          : null;
      return (
        <>
          At full saturation this business makes {money(d.ceilingRevenue)} a month against{' '}
          {money(p.monthlyBurn)} of burn. It works. But cash crosses zero in month{' '}
          {d.runoutMonth}
          {d.breakevenMonth !== null ? (
            <>
              , and revenue does not cover burn until month {d.breakevenMonth}. You are {gap}{' '}
              months short of a business that would have been fine.
            </>
          ) : (
            <>, long before the model ever gets there.</>
          )}
        </>
      );
    }

    case 'never_runs_out': {
      const dips = d.lowestCashMonth > 0 && d.lowestCash < p.startingCash;
      if (dips) {
        return (
          <>
            Cash still dips, bottoming at {money(d.lowestCash)} in month {d.lowestCashMonth}, and
            then compounds upward instead of down. Steady state is {money(d.ceilingRevenue)} a
            month against {money(p.monthlyBurn)} of burn.
          </>
        );
      }
      return (
        <>
          Cash never dips below {money(d.lowestCash)}. Revenue covers burn
          {d.breakevenMonth !== null ? ` from month ${d.breakevenMonth}` : ' from the start'}, and
          the curve only goes up. Boring, which is the point.
        </>
      );
    }

    case 'structural_runout':
      return (
        <>
          Even with every customer you will ever have, this makes {money(d.ceilingRevenue)} a
          month against {money(p.monthlyBurn)} of burn — a{' '}
          {money(p.monthlyBurn - d.ceilingRevenue)} hole that more time does not fill.{' '}
          {p.churn > 0 && (
            <>
              At {percent(p.churn)} churn, {p.newPerMonth} signups a month saturates at{' '}
              {count(d.ceilingCustomers)} customers. This is a structural problem, not a timing
              problem.
            </>
          )}
        </>
      );

    case 'plateau_below_burn':
      return (
        <>
          Revenue tops out at {money(d.ceilingRevenue)} a month against {money(p.monthlyBurn)} of
          burn. At month {months} you still have {money(d.finalCash)} and you are losing{' '}
          {money(p.monthlyBurn - d.finalRevenue)} a month. The death is just past the edge of
          this chart.
        </>
      );
  }
}

export default function Verdict({ derived, params, months, isFork }: Props) {
  const text = headline(derived, months);

  return (
    <section className="flex w-full flex-col gap-1.5">
      <h1 className="text-[34px] leading-[42px] font-semibold tracking-[-0.68px] text-balance text-ink">
        {isFork ? `In this fork, ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text}
      </h1>
      <p className="max-w-[760px] text-[15px] leading-[24px] text-ink-2">
        {body(derived, params, months)}
      </p>
    </section>
  );
}
