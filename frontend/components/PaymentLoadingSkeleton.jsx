import LoadingStatusLine from '@/components/LoadingStatusLine';

export default function PaymentLoadingSkeleton({ statusLabel }) {
  return (
    <section className="payment-loading" aria-busy="true">
      <LoadingStatusLine label={statusLabel} />

      <div className="payment-loading__hold" aria-hidden="true">
        <span className="skeleton-line skeleton-line--xs skeleton-line--w-30" />
        <span className="skeleton-line skeleton-line--lg skeleton-line--w-40" />
      </div>

      <span
        className="skeleton-line skeleton-line--heading skeleton-line--w-55"
        aria-hidden="true"
      />
      <span className="skeleton-line skeleton-line--w-90" aria-hidden="true" />
      <span className="skeleton-line skeleton-line--w-70" aria-hidden="true" />

      <div className="payment-loading__panel" aria-hidden="true">
        <span className="skeleton-line skeleton-line--xs skeleton-line--w-30" />
        <span className="skeleton-line skeleton-line--w-70" />
        <span className="skeleton-line skeleton-line--w-50" />
        <span className="skeleton-line skeleton-line--w-60" />
      </div>
    </section>
  );
}
