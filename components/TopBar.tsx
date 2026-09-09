import Link from 'next/link';
import type { ReactNode } from 'react';

/** The one chrome element shared by all three states. Wordmark left, actions right. */
export default function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="w-full border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-10 py-5">
        <Link
          href="/"
          className="text-[13px] leading-4 font-semibold tracking-[1.04px] text-ink"
        >
          PRIME RADIANT
        </Link>
        <div className="flex items-center gap-2.5">{children}</div>
      </div>
    </header>
  );
}
