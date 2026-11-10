import EventLayout from '../../(event)/EventLayout';

export default async function EventSlugScopedLayout({ params, children }) {
  const { eventSlug } = await params;
  return <EventLayout slug={eventSlug}>{children}</EventLayout>;
}
