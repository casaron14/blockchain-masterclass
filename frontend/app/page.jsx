import { redirect } from 'next/navigation';
import { DEFAULT_EVENT_SLUG } from '@/lib/eventConfig';

export default function HomePage() {
  redirect(`/${DEFAULT_EVENT_SLUG}`);
}
