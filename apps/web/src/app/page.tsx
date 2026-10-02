import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

/** Phase 1 front door. The full landing, pricing and SEO pages come in Phase 2. */
export default function Landing() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-[560px] flex-col px-6 py-10">
      <div className="flex items-center gap-3">
        <div aria-hidden className="ribbon h-9 w-5 bg-accent" />
        <span className="font-serif text-2xl font-medium">BookMarker</span>
        <span className="-mr-3 ml-auto">
          <ThemeToggle />
        </span>
      </div>
      <h1 className="mt-16 font-serif text-[40px] font-medium leading-[1.05] tracking-tight">
        Read together, at your own pace.
      </h1>
      <p className="mt-5 font-serif text-lg leading-relaxed">
        Move your bookmark as you read. Your friends’ thoughts wait for you at every chapter, and
        nothing past your bookmark ever reaches you.
      </p>
      <div className="mt-10 flex flex-col gap-3">
        <Link
          href="/signin"
          className="flex min-h-12 items-center justify-center rounded bg-accent px-5 font-semibold text-on-accent no-underline hover:bg-accent-strong hover:text-on-accent"
        >
          Start or join a club
        </Link>
        <p className="text-sm text-muted">Free while we’re in early access.</p>
      </div>
      <ol className="mt-16 flex flex-col gap-6 border-t border-rule pt-8">
        {[
          ['Move your bookmark', 'Tap a chapter or drag the ribbon when you finish one.'],
          [
            'See what was waiting',
            'Thoughts your friends left there unlock the moment you arrive.',
          ],
          ['Leave yours', 'Post where you are. Only friends who have read that far will see it.'],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-4">
            <span className="font-serif text-3xl text-accent">{i + 1}</span>
            <div>
              <h2 className="font-serif text-xl font-medium">{title}</h2>
              <p className="text-[15px] text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
