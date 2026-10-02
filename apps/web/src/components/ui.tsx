'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BackIcon, BookIcon, LetterIcon, PeopleIcon, PersonIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'outline' | 'danger';
}) {
  const styles = {
    primary: 'bg-accent text-on-accent hover:bg-accent-strong px-[18px] font-semibold',
    quiet: 'bg-transparent text-accent hover:text-accent-strong px-1 font-semibold',
    outline: 'border border-rule bg-transparent text-ink hover:bg-panel px-4 font-semibold',
    danger: 'border border-danger bg-transparent text-danger px-4 font-semibold',
  }[variant];
  return (
    <button
      className={`min-h-11 rounded text-[15px] disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
      {...props}
    />
  );
}

export function TopBar({
  back,
  title,
  right,
}: {
  back?: string;
  title?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between px-3 pt-3.5">
      {back ? (
        <Link
          href={back}
          aria-label="Back"
          className="flex h-11 w-11 items-center justify-center text-ink"
        >
          <BackIcon />
        </Link>
      ) : (
        <span className="w-11" />
      )}
      {title && <div className="truncate text-sm text-muted">{title}</div>}
      <div className="flex items-center">
        {right}
        <ThemeToggle />
      </div>
    </header>
  );
}

/** The light/dark switch, top right, for screens without a TopBar. */
export function TopRow() {
  return (
    <div className="flex justify-end px-3 pt-3.5">
      <ThemeToggle />
    </div>
  );
}

const NAV = [
  { href: '/home', label: 'Reading', Icon: BookIcon },
  { href: '/clubs', label: 'Clubs', Icon: PeopleIcon },
  { href: '/letters', label: 'Letters', Icon: LetterIcon },
  { href: '/profile', label: 'Profile', Icon: PersonIcon },
];

export function BottomNav({ unread = 0 }: { unread?: number }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 mt-auto grid grid-cols-4 border-t border-rule bg-paper px-2 pb-4 pt-2"
    >
      {NAV.map(({ href, label, Icon }) => {
        const active = path === href || (href !== '/home' && path.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 text-[11px] no-underline ${
              active ? 'font-bold text-accent' : 'text-muted'
            }`}
          >
            <Icon />
            {label}
            {label === 'Letters' && unread > 0 && (
              <span className="sr-only">, {unread} unread</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** The phone-width column every screen lives in (PRD: phone first, 390 px). */
export function Screen({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto flex min-h-dvh w-full max-w-[560px] flex-col bg-page sm:border-x sm:border-rule-soft ${className}`}
    >
      {children}
    </div>
  );
}

export function Ribbon({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`ribbon bg-accent ${className}`} />;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <p role="alert" className="text-sm text-danger">
      {msg}
    </p>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="p-6 font-serif text-base italic text-muted">
      {label}…
    </div>
  );
}

export function Avatar({
  name,
  url,
  size = 40,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  return url ? (
    <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" />
  ) : (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-full bg-spine font-semibold text-ink"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {name
        .split(/\s+/)
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}
