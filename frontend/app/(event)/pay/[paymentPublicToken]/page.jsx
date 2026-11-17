import PaymentPageContent from '@/components/PaymentPageContent';

export default async function PaymentPage({ params }) {
  const { paymentPublicToken } = await params;
  return <PaymentPageContent paymentPublicToken={paymentPublicToken} />;
}
