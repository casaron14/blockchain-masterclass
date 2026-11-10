import EventLayout from './EventLayout';

// The bare domain has no event slug. EventProvider asks the API which event is
// currently public (the open event when one exists) so the next event can be
// launched without redeploying the frontend.
export default function PublicEventLayout({ children }) {
  return <EventLayout>{children}</EventLayout>;
}
