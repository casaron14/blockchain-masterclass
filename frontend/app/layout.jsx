import './globals.css';
import { Bodoni_Moda, Archivo, DM_Mono } from 'next/font/google';
import RouteProgressBar from '@/components/RouteProgressBar';

const editorialDisplayFont = Bodoni_Moda({
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});

const institutionalBodyFont = Archivo({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

const ledgerMonoFont = DM_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata = {
  title: {
    default: 'Blockchain Masterclass — DienAcademy',
    template: '%s | Blockchain Masterclass',
  },
  description:
    'A one-day, beginner-friendly blockchain masterclass in Arusha, Tanzania. 7 November 2026. 150 seats. TZS 10,000.',
  applicationName: 'Blockchain Masterclass',
  openGraph: {
    title: 'Blockchain Masterclass — DienAcademy',
    description:
      'One day. Three sessions. A practical blockchain education in Arusha, Tanzania. 7 November 2026.',
    type: 'website',
  },
};

export const viewport = {
  themeColor: '#14120e',
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${editorialDisplayFont.variable} ${institutionalBodyFont.variable} ${ledgerMonoFont.variable}`}
    >
      <body>
        <RouteProgressBar />
        {children}
      </body>
    </html>
  );
}
