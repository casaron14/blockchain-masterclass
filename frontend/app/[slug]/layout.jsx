import { notFound } from 'next/navigation';
import EventLayout from './EventLayout';
import { checkEventSlugExistsInConfiguration } from '@/lib/eventConfig';

export default async function MasterEventLayout({ children, params }) {
  const { slug } = await params;

  if (!checkEventSlugExistsInConfiguration(slug)) {
    notFound();
  }

  return <EventLayout slug={slug}>{children}</EventLayout>;
}
