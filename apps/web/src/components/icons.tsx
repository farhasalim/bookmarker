/** Stroke icons drawn inline (no icon font, no external requests). */
type P = { size?: number; className?: string; label?: string };

const svg = (
  size: number,
  className: string | undefined,
  label: string | undefined,
  children: React.ReactNode,
  fill = 'none',
) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    {children}
  </svg>
);

export const BackIcon = ({ size = 20, className, label }: P) =>
  svg(
    size,
    className,
    label,
    <>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </>,
  );
export const MenuIcon = ({ size = 20, className, label }: P) =>
  svg(
    size,
    className,
    label,
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h10" />
    </>,
  );
export const LockIcon = ({ size = 14, className, label }: P) =>
  svg(
    size,
    className,
    label,
    <>
      <rect x="5" y="11" width="14" height="10" rx="1.5" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>,
  );
export const BookIcon = ({ size = 22, className, label }: P) =>
  svg(
    size,
    className,
    label,
    <>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5z" />
      <path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5" />
    </>,
  );
export const PeopleIcon = ({ size = 22, className, label }: P) =>
  svg(
    size,
    className,
    label,
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0" />
      <path d="M16 4.5a3.5 3.5 0 010 7" />
      <path d="M18 14a6 6 0 013.5 6" />
    </>,
  );
export const LetterIcon = ({ size = 22, className, label }: P) =>
  svg(
    size,
    className,
    label,
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3 7l9 6 9-6" />
    </>,
  );
export const PersonIcon = ({ size = 22, className, label }: P) =>
  svg(
    size,
    className,
    label,
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>,
  );
export const GearIcon = ({ size = 20, className, label }: P) =>
  svg(
    size,
    className,
    label,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>,
  );
export const UpIcon = ({ size = 16, className, label }: P) =>
  svg(size, className, label, <path d="M6 15l6-6 6 6" />);
export const DownIcon = ({ size = 16, className, label }: P) =>
  svg(size, className, label, <path d="M6 9l6 6 6-6" />);
export const CloseIcon = ({ size = 16, className, label }: P) =>
  svg(
    size,
    className,
    label,
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>,
  );

export function StarIcon({ size = 20, filled = true, className, label }: P & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill={filled ? 'var(--star)' : 'none'}
      stroke="var(--star)"
      strokeWidth={1.3}
      strokeLinejoin="round"
    >
      <polygon points="12 2.5 14.8 9 21.5 9.4 16.4 13.8 18 20.5 12 16.9 6 20.5 7.6 13.8 2.5 9.4 9.2 9" />
    </svg>
  );
}
