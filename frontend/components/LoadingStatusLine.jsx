import HairlineLoadingIndicator from '@/components/HairlineLoadingIndicator';

export default function LoadingStatusLine({
  label,
  tone = 'paper',
  compact = false,
  spaced = false,
  className = '',
}) {
  const isOnInk = tone === 'ink';
  const statusClassName = [
    'loading-status',
    isOnInk ? 'loading-status--on-ink' : '',
    compact ? 'loading-status--compact' : '',
    spaced ? 'loading-status--spaced' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <p className={statusClassName} role="status" aria-live="polite">
      <HairlineLoadingIndicator
        color={isOnInk ? '#f2ede3' : '#a34a25'}
        size={compact ? 10 : 12}
      />
      <span className="loading-status__label">{label}</span>
      {!compact && (
        <span className="loading-rule" aria-hidden="true">
          <span className="loading-rule__bar" />
        </span>
      )}
    </p>
  );
}
