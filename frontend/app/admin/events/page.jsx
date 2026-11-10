'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminCreateEvent,
  adminFetchEventList,
  adminUpdateEvent,
} from '@/lib/api';
import { useAdmin } from '@/context/AdminContext';
import LoadingButton from '@/components/LoadingButton';
import RecordLoadingSkeleton from '@/components/RecordLoadingSkeleton';
import AdminSessionLoading from '@/components/AdminSessionLoading';
import { buildEventHomeUrl } from '@/lib/siteRoutes';

const EMPTY_EVENT_FORM = {
  slug: '',
  name: '',
  status: 'draft',
  eventDate: '',
  eventTicketDateLabel: '',
  eventLocation: '',
  eventVenueName: '',
  eventMotto: '',
  priceLocalAmount: '',
  priceCryptoAmount: '',
  seatCapacity: '150',
};

function buildEventCreationPayload(formValues) {
  const configuration = {
    name: formValues.name,
    event: {
      date: formValues.eventDate,
      ticketDateLabel: formValues.eventTicketDateLabel,
      location: formValues.eventLocation,
      venueName: formValues.eventVenueName,
      motto: formValues.eventMotto,
    },
    price: {},
  };

  if (formValues.priceLocalAmount.trim()) {
    configuration.price.localAmount = Number(formValues.priceLocalAmount);
  }
  if (formValues.priceCryptoAmount.trim()) {
    configuration.price.cryptoAmount = Number(formValues.priceCryptoAmount);
  }

  const payload = {
    slug: formValues.slug.trim(),
    name: formValues.name.trim(),
    status: formValues.status,
    ...configuration,
  };

  if (formValues.seatCapacity.trim()) {
    payload.seatCapacity = Number(formValues.seatCapacity);
  }

  return payload;
}

export default function AdminEventsPage() {
  const router = useRouter();
  const { adminToken, adminUser, isSessionRestoring, isLoggingOut, logoutAdminSession } =
    useAdmin();

  const [eventRecords, setEventRecords] = useState([]);
  const [formValues, setFormValues] = useState(EMPTY_EVENT_FORM);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [updatingEventId, setUpdatingEventId] = useState(null);
  const [formError, setFormError] = useState(null);

  const loadEventRecords = useCallback(() => {
    if (isSessionRestoring) {
      return;
    }
    if (!adminToken) {
      router.replace('/admin/login');
      return;
    }

    setIsLoadingEvents(true);
    setFormError(null);
    adminFetchEventList(adminToken)
      .then((responseBody) => setEventRecords(responseBody.events ?? []))
      .catch((error) => setFormError(error.message || 'Events could not be loaded.'))
      .finally(() => setIsLoadingEvents(false));
  }, [isSessionRestoring, adminToken, router]);

  useEffect(loadEventRecords, [loadEventRecords]);

  function updateFormField(fieldKey, nextValue) {
    setFormValues((currentValues) => ({
      ...currentValues,
      [fieldKey]: nextValue,
    }));
  }

  async function handleCreateEvent(event) {
    event.preventDefault();
    setFormError(null);
    setIsCreatingEvent(true);
    try {
      await adminCreateEvent(buildEventCreationPayload(formValues), adminToken);
      setFormValues(EMPTY_EVENT_FORM);
      loadEventRecords();
    } catch (error) {
      setFormError(error.message || 'The event could not be created.');
    } finally {
      setIsCreatingEvent(false);
    }
  }

  async function updateEventLifecycleStatus(eventId, lifecycleStatus) {
    setFormError(null);
    setUpdatingEventId(eventId);
    try {
      await adminUpdateEvent(eventId, { status: lifecycleStatus }, adminToken);
      loadEventRecords();
    } catch (error) {
      setFormError(error.message || 'The event status could not be updated.');
    } finally {
      setUpdatingEventId(null);
    }
  }

  if (isSessionRestoring) {
    return <AdminSessionLoading />;
  }

  if (!adminToken) {
    return null;
  }

  return (
    <>
      <section className="card">
        <div className="admin-toolbar">
          <div>
            <h2 className="card__title">Events</h2>
            <p className="muted">
              Signed in as {adminUser?.username || 'admin'} · keep the completed event
              archived and open the next one when it is ready
            </p>
          </div>
          <LoadingButton
            type="button"
            className="btn btn-secondary"
            autoLoading={false}
            loading={isLoggingOut}
            loadingLabel="Signing out…"
            onClick={logoutAdminSession}
          >
            Sign out
          </LoadingButton>
        </div>

        {formError && <p className="error-banner">{formError}</p>}

        {isLoadingEvents ? (
          <RecordLoadingSkeleton statusLabel="Loading events…" sectionCount={2} />
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Seats</th>
                  <th>Bookings</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {eventRecords.map((eventRecord) => (
                  <tr key={eventRecord.id}>
                    <td>
                      <strong>{eventRecord.name}</strong>
                      <div className="muted">{eventRecord.slug}</div>
                    </td>
                    <td>{eventRecord.status}</td>
                    <td>
                      {eventRecord.confirmedCount} / {eventRecord.seatCapacity}
                    </td>
                    <td>{eventRecord.bookingCount}</td>
                    <td>
                      <Link
                        className="text-link"
                        href={buildEventHomeUrl(eventRecord.slug)}
                      >
                        View site
                      </Link>
                      <Link
                        className="text-link"
                        href={`/admin/settings?event=${encodeURIComponent(eventRecord.slug)}`}
                      >
                        Settings
                      </Link>
                      {eventRecord.status !== 'open' && (
                        <LoadingButton
                          type="button"
                          className="btn btn-secondary"
                          autoLoading={false}
                          loading={updatingEventId === eventRecord.id}
                          loadingLabel="Opening…"
                          onClick={() =>
                            updateEventLifecycleStatus(eventRecord.id, 'open')
                          }
                        >
                          Open
                        </LoadingButton>
                      )}
                      {eventRecord.status === 'open' && (
                        <LoadingButton
                          type="button"
                          className="btn btn-secondary"
                          autoLoading={false}
                          loading={updatingEventId === eventRecord.id}
                          loadingLabel="Closing…"
                          onClick={() =>
                            updateEventLifecycleStatus(eventRecord.id, 'closed')
                          }
                        >
                          Close
                        </LoadingButton>
                      )}
                      {eventRecord.status !== 'archived' && (
                        <LoadingButton
                          type="button"
                          className="btn btn-secondary"
                          autoLoading={false}
                          loading={updatingEventId === eventRecord.id}
                          loadingLabel="Archiving…"
                          onClick={() =>
                            updateEventLifecycleStatus(eventRecord.id, 'archived')
                          }
                        >
                          Archive
                        </LoadingButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Create the next event</h2>
        <p className="muted">
          Saving as a draft hides it from attendees. Open it when the booking page is
          ready.
        </p>

        <form className="settings-form" onSubmit={handleCreateEvent}>
          <label className="field">
            <span>Slug</span>
            <input
              required
              value={formValues.slug}
              onChange={(event) => updateFormField('slug', event.target.value)}
              placeholder="blockchain-masterclass-2027"
            />
          </label>
          <label className="field">
            <span>Event name</span>
            <input
              required
              value={formValues.name}
              onChange={(event) => updateFormField('name', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Date label</span>
            <input
              value={formValues.eventDate}
              onChange={(event) => updateFormField('eventDate', event.target.value)}
              placeholder="7th November 2027"
            />
          </label>
          <label className="field">
            <span>Ticket date label</span>
            <input
              value={formValues.eventTicketDateLabel}
              onChange={(event) =>
                updateFormField('eventTicketDateLabel', event.target.value)
              }
              placeholder="07/11/2027"
            />
          </label>
          <label className="field">
            <span>Location</span>
            <input
              value={formValues.eventLocation}
              onChange={(event) => updateFormField('eventLocation', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Venue</span>
            <input
              value={formValues.eventVenueName}
              onChange={(event) =>
                updateFormField('eventVenueName', event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Motto</span>
            <input
              value={formValues.eventMotto}
              onChange={(event) => updateFormField('eventMotto', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Local price (TZS)</span>
            <input
              type="number"
              min="1"
              value={formValues.priceLocalAmount}
              onChange={(event) =>
                updateFormField('priceLocalAmount', event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Crypto price (USDT)</span>
            <input
              type="number"
              min="0.00000001"
              step="0.00000001"
              value={formValues.priceCryptoAmount}
              onChange={(event) =>
                updateFormField('priceCryptoAmount', event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Seat capacity</span>
            <input
              type="number"
              min="1"
              value={formValues.seatCapacity}
              onChange={(event) => updateFormField('seatCapacity', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={formValues.status}
              onChange={(event) => updateFormField('status', event.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="open">Open</option>
            </select>
          </label>

          <LoadingButton
            type="submit"
            className="btn btn-primary"
            autoLoading={false}
            loading={isCreatingEvent}
            loadingLabel="Creating event…"
          >
            Create event
          </LoadingButton>
        </form>
      </section>
    </>
  );
}
