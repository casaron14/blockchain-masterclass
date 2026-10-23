import SuccessCard from '@/components/SuccessCard';

export default async function SuccessPage({ params }) {
  const { ref } = await params;
  return (
    <div className="success-page">
      <div className="shell success-page__inner">
        <SuccessCard referenceCode={ref} />
      </div>
    </div>
  );
}
