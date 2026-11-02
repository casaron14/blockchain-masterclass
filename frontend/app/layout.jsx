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

// WhatsApp and other social crawlers require absolute image URLs. Vercel
// exposes its production hostname during the build; self-hosted deployments
// set NEXT_PUBLIC_SITE_URL to their canonical public origin.
const publicSiteUrlForSocialImages =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000');

export const metadata = {
  metadataBase: new URL(publicSiteUrlForSocialImages),
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
    url: './',
    siteName: 'DienAcademy',
    type: 'website',
    images: [
      {
        url: '/blockchain-masterclass-opengraph.jpg',
        type: 'image/jpeg',
        width: 1200,
        height: 630,
        alt: 'Blockchain Masterclass — DienAcademy',
      },
    ],
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
