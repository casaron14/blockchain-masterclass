import EventLayout from './EventLayout';
import { defaultEventConfig } from '@/lib/eventConfig';

// Every public page belongs to the single event served from this domain, so the
// layout no longer reads a slug from the URL. The slug is still passed to the
// event provider because the API and browser storage are keyed by it.
export default function PublicEventLayout({ children }) {
  return <EventLayout slug={defaultEventConfig.slug}>{children}</EventLayout>;
}
