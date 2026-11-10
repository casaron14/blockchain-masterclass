import PaymentConfirmationPageContent from '@/components/PaymentConfirmationPageContent';

export default async function EventScopedPaymentConfirmationPage({ params }) {
  const { paymentId } = await params;
  return <PaymentConfirmationPageContent paymentId={paymentId} />;
}
