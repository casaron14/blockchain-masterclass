import PaymentPageContent from '@/components/PaymentPageContent';

export default async function EventScopedPaymentPage({ params }) {
  const { paymentId } = await params;
  return <PaymentPageContent paymentId={paymentId} />;
}
