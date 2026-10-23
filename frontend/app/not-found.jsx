import { EventProvider } from '@/context/EventContext';
import { LanguageProvider } from '@/context/LanguageContext';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import NotFoundRecord from '@/components/NotFoundRecord';
import { defaultEventConfig } from '@/lib/eventConfig';

export default function RootNotFoundPage() {
  return (
    <EventProvider slug={defaultEventConfig.slug}>
      <LanguageProvider>
        <Header />
        <main>
          <NotFoundRecord />
        </main>
        <Footer />
      </LanguageProvider>
    </EventProvider>
  );
}
