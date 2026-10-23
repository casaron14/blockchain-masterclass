import PaymentPageContent from '@/components/PaymentPageContent';

export default async function PaymentPage({ params }) {
  const { paymentId } = await params;
  return <PaymentPageContent paymentId={paymentId} />;
}
