import LoadingStatusLine from '@/components/LoadingStatusLine';

const RECORD_LOADING_FIELD_COUNT = 4;

export default function RecordLoadingSkeleton({
  statusLabel,
  sectionCount = 2,
  tone = 'paper',
}) {
  return (
    <section className={`record-loading record-loading--${tone}`} aria-busy="true">
      <LoadingStatusLine label={statusLabel} tone={tone} />

      {Array.from({ length: sectionCount }, (_, sectionIndex) => (
        <div className="record-loading__section" key={sectionIndex} aria-hidden="true">
          <span className="skeleton-line skeleton-line--heading" />
          <div className="record-loading__grid">
            {Array.from({ length: RECORD_LOADING_FIELD_COUNT }, (_, fieldIndex) => (
              <div className="record-loading__field" key={fieldIndex}>
                <span className="skeleton-line skeleton-line--xs" />
                <span className="skeleton-line skeleton-line--input" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
