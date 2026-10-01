import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'BookMarker', template: '%s · BookMarker' },
  description:
    'A spoiler-safe reading room for book clubs. Read at your own pace; your friends’ thoughts wait for you at every chapter.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#dbeada' },
    { media: '(prefers-color-scheme: dark)', color: '#121813' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-paper focus:p-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
