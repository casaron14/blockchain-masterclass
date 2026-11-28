'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminSendAttendeeReminderBatch } from '@/lib/api';
import { useAdmin } from '@/context/AdminContext';
import LoadingButton from '@/components/LoadingButton';
import AdminSessionLoading from '@/components/AdminSessionLoading';

const REMINDER_AUDIENCES = [
  {
    key: 'confirmed',
    title: 'Confirmed attendees',
    description: 'Send the event date, venue and booking reference to clients whose registration is confirmed.',
    buttonLabel: 'Send event reminders',
  },
  {
    key: 'unpaid',
    title: 'Payment not completed',
    description: 'Ask pending or expired bookings without a confirmed payment to return and complete payment.',
    buttonLabel: 'Send payment reminders',
  },
];

export default function AdminReminderPage() {
  const router = useRouter();
  const { adminToken, isSessionRestoring } = useAdmin();
  const [sendingAudience, setSendingAudience] = useState(null);
  const [reminderFeedback, setReminderFeedback] = useState({});

  useEffect(() => {
    if (!isSessionRestoring && !adminToken) {
      router.replace('/admin/login');
    }
  }, [isSessionRestoring, adminToken, router]);

  async function sendReminderBatch(reminderAudience) {
    const confirmed = window.confirm(
      `Send a reminder email to every eligible ${reminderAudience} attendee? Attendees who already received this reminder will be skipped.`
    );
    if (!confirmed) return;

    setSendingAudience(reminderAudience);
    setReminderFeedback((currentFeedback) => ({
      ...currentFeedback,
      [reminderAudience]: null,
    }));

    try {
      const responseBody = await adminSendAttendeeReminderBatch(
        reminderAudience,
        adminToken
      );
      const summary = responseBody.reminderSummary;
      const remainingMessage = summary.remainingCount > 0
        ? ` ${summary.remainingCount} eligible attendee(s) remain; run the batch again to continue.`
        : '';
      setReminderFeedback((currentFeedback) => ({
        ...currentFeedback,
        [reminderAudience]: {
          tone: summary.failedCount > 0 ? 'info' : 'success',
          message: summary.skipped
            ? 'Email delivery is disabled on the server.'
            : `Sent ${summary.sentCount} reminder(s); ${summary.failedCount} failed.${remainingMessage}`,
        },
      }));
    } catch (error) {
      setReminderFeedback((currentFeedback) => ({
        ...currentFeedback,
        [reminderAudience]: {
          tone: 'error',
          message: error.message || 'Reminder emails could not be sent.',
        },
      }));
    } finally {
      setSendingAudience(null);
    }
  }

  if (isSessionRestoring) return <AdminSessionLoading />;
  if (!adminToken) return null;

  return (
    <section className="card">
      <h2 className="card__title">Attendee reminders</h2>
      <p className="muted">
        Each attendee receives each reminder type once. Failed deliveries stay eligible for the next batch.
      </p>
      <div className="admin-settings-grid">
        {REMINDER_AUDIENCES.map((audience) => (
          <section className="card" key={audience.key}>
            <h3 className="card__title">{audience.title}</h3>
            <p className="muted">{audience.description}</p>
            {reminderFeedback[audience.key] && (
              <p className={`status-message ${reminderFeedback[audience.key].tone}`}>
                {reminderFeedback[audience.key].message}
              </p>
            )}
            <LoadingButton
              type="button"
              className="btn btn-primary"
              autoLoading={false}
              loading={sendingAudience === audience.key}
              loadingLabel="Sending reminders…"
              disabled={sendingAudience !== null}
              onClick={() => sendReminderBatch(audience.key)}
            >
              {audience.buttonLabel}
            </LoadingButton>
          </section>
        ))}
      </div>
    </section>
  );
}
