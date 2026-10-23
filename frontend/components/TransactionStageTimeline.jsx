'use client';

import { formatAdminTimestamp } from '@/lib/adminFormatting';

const STAGE_STATUS_LABELS = {
  done: 'Complete',
  current: 'In progress',
  waiting: 'Pending',
  failed: 'Failed',
};

function formatStageTimestamp(rawTimestamp) {
  if (!rawTimestamp) {
    return '';
  }
  return formatAdminTimestamp(rawTimestamp);
}

export default function TransactionStageTimeline({ stages }) {
  if (!stages || stages.length === 0) {
    return <p className="muted">No stage information available.</p>;
  }

  return (
    <ol className="stage-timeline">
      {stages.map((stage) => (
        <li
          key={stage.key}
          className={`stage-timeline__item stage-timeline__item--${stage.status}`}
        >
          <span className="stage-timeline__dot" aria-hidden="true" />
          <div className="stage-timeline__body">
            <strong className="stage-timeline__label">{stage.label}</strong>
            <span className="stage-timeline__meta">
              {stage.status === 'done' && stage.at
                ? formatStageTimestamp(stage.at)
                : STAGE_STATUS_LABELS[stage.status]}
            </span>
            {stage.detail && <code className="stage-timeline__detail">{String(stage.detail)}</code>}
          </div>
        </li>
      ))}
    </ol>
  );
}