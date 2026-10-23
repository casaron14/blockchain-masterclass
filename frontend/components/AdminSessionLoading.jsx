import LoadingStatusLine from '@/components/LoadingStatusLine';

export default function AdminSessionLoading({
  statusLabel = 'Restoring your admin session…',
}) {
  return (
    <section className="admin-session-loading" aria-busy="true">
      <LoadingStatusLine label={statusLabel} />

      <div className="admin-session-loading__sheet" aria-hidden="true">
        <span className="skeleton-line skeleton-line--heading skeleton-line--w-40" />
        <span className="skeleton-line skeleton-line--w-70" />
        <span className="skeleton-line skeleton-line--w-55" />
      </div>
    </section>
  );
}
