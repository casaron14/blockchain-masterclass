import PaymentConfirmationPageContent from '@/components/PaymentConfirmationPageContent';

export default async function PaymentConfirmationPage({ params }) {
  const { paymentId } = await params;
  return <PaymentConfirmationPageContent paymentId={paymentId} />;
}
