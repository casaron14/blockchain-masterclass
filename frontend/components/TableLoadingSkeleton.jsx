import LoadingStatusLine from '@/components/LoadingStatusLine';

const BOOKING_COLUMN_LABELS = [
  'Ref',
  'Attendee',
  'Contact',
  'Status',
  'Payment',
  'Created',
  '',
];

const TRANSACTION_COLUMN_LABELS = [
  'Method',
  'Ref',
  'Attendee',
  'Amount',
  'Payment status',
  'Booking',
  'Created',
];

const SKELETON_WIDTH_CLASSES = [
  'skeleton-line--w-45',
  'skeleton-line--w-70',
  'skeleton-line--w-85',
  'skeleton-line--w-50',
  'skeleton-line--w-60',
  'skeleton-line--w-70',
  'skeleton-line--w-30',
];

export default function TableLoadingSkeleton({
  tableKind = 'bookings',
  columnLabels,
  rowCount = 4,
  statusLabel,
}) {
  const resolvedColumnLabels =
    columnLabels || (tableKind === 'transactions' ? TRANSACTION_COLUMN_LABELS : BOOKING_COLUMN_LABELS);

  return (
    <div className="table-loading" aria-busy="true">
      <LoadingStatusLine label={statusLabel} />

      <div className="table-scroll">
        <table className="admin-table table-loading__table" aria-hidden="true">
          <thead>
            <tr>
              {resolvedColumnLabels.map((columnLabel, columnIndex) => (
                <th key={`${columnLabel}-${columnIndex}`}>{columnLabel}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, rowIndex) => (
              <tr key={rowIndex}>
                {resolvedColumnLabels.map((columnLabel, columnIndex) => (
                  <td key={`${columnLabel}-${columnIndex}`}>
                    <span
                      className={`skeleton-line ${
                        SKELETON_WIDTH_CLASSES[columnIndex % SKELETON_WIDTH_CLASSES.length]
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
