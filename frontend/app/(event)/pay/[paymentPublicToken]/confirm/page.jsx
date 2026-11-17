import PaymentConfirmationPageContent from '@/components/PaymentConfirmationPageContent';

export default async function PaymentConfirmationPage({ params }) {
  const { paymentPublicToken } = await params;
  return <PaymentConfirmationPageContent paymentPublicToken={paymentPublicToken} />;
}
