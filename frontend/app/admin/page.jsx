'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminCreateBooking,
  adminDownloadBookingsCsv,
  adminFetchBookingList,
  adminRedeliverTicketEmail,
  adminSyncBookingsToGoogleSheet,
} from '@/lib/api';
import { useAdmin } from '@/context/AdminContext';
import LoadingButton from '@/components/LoadingButton';
import TableLoadingSkeleton from '@/components/TableLoadingSkeleton';
import AdminSessionLoading from '@/components/AdminSessionLoading';
import { formatAdminStatusLabel, formatAdminTimestamp } from '@/lib/adminFormatting';

const BOOKING_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];

function formatCreatedDate(rawDate) {
  return formatAdminTimestamp(rawDate);
}

function BookingCreateForm({ adminToken, onCreateBooking }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [referralSourceCode, setReferralSourceCode] = useState('');
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      await adminCreateBooking(
        {
          full_name: fullName.trim(),
          email: email.trim(),
          phone_number: phoneNumber.trim(),
          utm_source: referralSourceCode.trim(),
          autoConfirm,
        },
        adminToken
      );
      setFullName('');
      setEmail('');
      setPhoneNumber('');
      setReferralSourceCode('');
      setAutoConfirm(false);
      onCreateBooking();
    } catch (error) {
      setFormError(error.message || 'Booking could not be created.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">Create a booking</h2>
      <form className="form" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>Full name</span>
          <input
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Email address</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Phone number</span>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Referral username or source (optional)</span>
          <input
            type="text"
            value={referralSourceCode}
            onChange={(event) => setReferralSourceCode(event.target.value)}
            placeholder="neema"
            autoComplete="off"
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={autoConfirm}
            onChange={(event) => setAutoConfirm(event.target.checked)}
          />
          <span>Confirm immediately</span>
        </label>
        {formError && <p className="error-banner">{formError}</p>}
        <LoadingButton
          type="submit"
          className="btn btn-primary"
          spinnerColor="#f2ede3"
          autoLoading={false}
          loading={isSubmitting}
          loadingLabel="Creating booking…"
        >
          Create booking
        </LoadingButton>
      </form>
    </section>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { adminToken, adminUser, isSessionRestoring, isLoggingOut, logoutAdminSession } = useAdmin();

  const [bookingRows, setBookingRows] = useState([]);
  const [statusCounts, setStatusCounts] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [bookingSearchInputValue, setBookingSearchInputValue] = useState('');
  const [appliedBookingSearchQuery, setAppliedBookingSearchQuery] = useState('');
  const [isLoadingBookings, setIsLoadingBookings] = useState(false);
  const [listError, setListError] = useState(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [isExportingBookings, setIsExportingBookings] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [isSyncingBookingsToGoogleSheet, setIsSyncingBookingsToGoogleSheet] =
    useState(false);
  const [googleSheetSyncFeedback, setGoogleSheetSyncFeedback] = useState(null);
  const [resendingTicketBookingId, setResendingTicketBookingId] = useState(null);
  const [ticketResendFeedback, setTicketResendFeedback] = useState(null);

  const refreshBookingList = useCallback(() => {
    setListRefreshKey((currentKey) => currentKey + 1);
  }, []);

  async function downloadBookingListCsv() {
    setExportError(null);
    setIsExportingBookings(true);

    try {
      await adminDownloadBookingsCsv(adminToken, {
        statusFilter,
        searchQuery: appliedBookingSearchQuery,
      });
    } catch (error) {
      setExportError(error.message || 'The booking export could not be downloaded.');
    } finally {
      setIsExportingBookings(false);
    }
  }

  // The button syncs every booking, not only the rows currently filtered on
  // screen: the Sheet is a recovery mirror, so a filtered sync would leave
  // bookings missing without the operator noticing.
  async function syncBookingsToGoogleSheet() {
    setGoogleSheetSyncFeedback(null);
    setIsSyncingBookingsToGoogleSheet(true);

    try {
      const syncResponse = await adminSyncBookingsToGoogleSheet(adminToken);
      setGoogleSheetSyncFeedback({
        tone:
          syncResponse.failedBookingCount > 0 ||
          syncResponse.totalBookingCount === 0
            ? 'info'
            : 'success',
        message:
          syncResponse.message ||
          `Synced ${syncResponse.syncedBookingCount ?? 0} booking(s).`,
      });
    } catch (error) {
      setGoogleSheetSyncFeedback({
        tone: 'error',
        message:
          error.message ||
          'The bookings could not be synced to Google Sheets.',
      });
    } finally {
      setIsSyncingBookingsToGoogleSheet(false);
    }
  }

  // The API resolves the recipient from the booking row and refuses a second
  // send, so this handler never accepts an address from the browser.
  async function resendTicketEmailForBooking(bookingRow) {
    setTicketResendFeedback(null);
    setResendingTicketBookingId(bookingRow.id);

    try {
      await adminRedeliverTicketEmail(bookingRow.id, adminToken);
      setTicketResendFeedback({
        tone: 'success',
        message: `Ticket email sent to ${bookingRow.email} for ${bookingRow.ref}.`,
      });
      refreshBookingList();
    } catch (error) {
      setTicketResendFeedback({
        tone: 'error',
        message:
          error.message ||
          `The ticket email for ${bookingRow.ref} could not be sent.`,
      });
    } finally {
      setResendingTicketBookingId(null);
    }
  }

  // Waiting for a pause in typing keeps the list from firing a request for
  // every letter of a name or email address.
  useEffect(() => {
    const searchDebounceTimer = window.setTimeout(() => {
      setAppliedBookingSearchQuery(bookingSearchInputValue.trim());
    }, 350);
    return () => window.clearTimeout(searchDebounceTimer);
  }, [bookingSearchInputValue]);

  useEffect(() => {
    if (isSessionRestoring) {
      return;
    }
    if (!adminToken) {
      router.replace('/admin/login');
      return;
    }
    setIsLoadingBookings(true);
    setListError(null);
    adminFetchBookingList({ statusFilter, searchQuery: appliedBookingSearchQuery, adminToken })
      .then((responseBody) => {
        setBookingRows(responseBody.bookings || []);
        setStatusCounts(responseBody.counts || null);
      })
      .catch((error) => {
        setListError(error.message || 'Bookings could not be loaded.');
      })
      .finally(() => setIsLoadingBookings(false));
  }, [
    isSessionRestoring,
    adminToken,
    statusFilter,
    appliedBookingSearchQuery,
    listRefreshKey,
    router,
  ]);

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
            <h2 className="card__title">Bookings</h2>
            <p className="muted">Signed in as {adminUser?.username || 'admin'}</p>
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
          <LoadingButton
            type="button"
            className="btn btn-primary"
            autoLoading={false}
            onClick={() => router.push('/admin/transactions')}
          >
            View transactions
          </LoadingButton>
          <LoadingButton
            type="button"
            className="btn btn-secondary"
            autoLoading={false}
            loading={isExportingBookings}
            loadingLabel="Preparing export…"
            onClick={downloadBookingListCsv}
          >
            Download CSV
          </LoadingButton>
          <LoadingButton
            type="button"
            className="btn btn-secondary"
            autoLoading={false}
            loading={isSyncingBookingsToGoogleSheet}
            loadingLabel="Syncing to Sheet…"
            onClick={syncBookingsToGoogleSheet}
          >
            Sync to Google Sheet
          </LoadingButton>
          <LoadingButton
            type="button"
            className="btn btn-secondary"
            autoLoading={false}
            onClick={() => router.push('/admin/settings')}
          >
            Settings
          </LoadingButton>
        </div>

        {exportError && <p className="error-banner">{exportError}</p>}
        {googleSheetSyncFeedback && (
          <p className={`status-message ${googleSheetSyncFeedback.tone}`}>
            {googleSheetSyncFeedback.message}
          </p>
        )}
        {ticketResendFeedback && (
          <p className={`status-message ${ticketResendFeedback.tone}`}>
            {ticketResendFeedback.message}
          </p>
        )}

        {statusCounts && (
          <div className="tx-summary-row">
            <span className={`tx-summary-chip ${statusCounts.pending > 0 ? 'pending' : ''}`}>
              {statusCounts.pending} pending
            </span>
            <span className={`tx-summary-chip ${statusCounts.confirmed > 0 ? 'confirmed' : ''}`}>
              {statusCounts.confirmed} confirmed
            </span>
            <span className={`tx-summary-chip ${statusCounts.cancelled > 0 ? 'failed' : ''}`}>
              {statusCounts.cancelled} cancelled
            </span>
            <span className={`tx-summary-chip ${statusCounts.expired > 0 ? 'failed' : ''}`}>
              {statusCounts.expired} expired
            </span>
          </div>
        )}

        <div className="admin-filter-row">
          <label className="field">
            <span>Search bookings</span>
            <input
              type="search"
              value={bookingSearchInputValue}
              onChange={(event) => setBookingSearchInputValue(event.target.value)}
              placeholder="Reference, name, email, or phone"
            />
          </label>
          <label className="field">
            <span>Filter by status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {BOOKING_STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <LoadingButton
            type="button"
            className="btn btn-secondary"
            autoLoading={false}
            loading={isLoadingBookings}
            loadingLabel="Refreshing…"
            onClick={refreshBookingList}
          >
            Refresh
          </LoadingButton>
        </div>

        {listError && <p className="error-banner">{listError}</p>}
        {isLoadingBookings ? (
          <TableLoadingSkeleton
            tableKind="bookings"
            rowCount={4}
            statusLabel="Fetching booking records…"
          />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Attendee</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Ticket</th>
                  <th>Referral</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bookingRows.map((bookingRow) => (
                  <tr key={bookingRow.id}>
                    <td>
                      <code>{bookingRow.ref}</code>
                    </td>
                    <td>
                      <strong>{bookingRow.full_name}</strong>
                    </td>
                    <td>
                      {bookingRow.email}
                      <br />
                      {bookingRow.phone_number}
                    </td>
                    <td>
                      <span className={`status-chip ${bookingRow.status}`}>
                        {formatAdminStatusLabel(bookingRow.status)}
                      </span>
                    </td>
                    <td>
                      <span className={`status-chip ${bookingRow.payment_status || ''}`}>
                        {bookingRow.payment_status ? formatAdminStatusLabel(bookingRow.payment_status) : 'None'}
                      </span>
                    </td>
                    <td>
                      {bookingRow.status === 'confirmed' ? (
                        <span
                          className={`status-chip ${
                            bookingRow.ticket_sent_at ? 'confirmed' : 'pending'
                          }`}
                        >
                          {bookingRow.ticket_sent_at ? 'Sent' : 'Not sent'}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{bookingRow.referrer_name || bookingRow.utm_source || '—'}</td>
                    <td>{formatCreatedDate(bookingRow.created_at)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <LoadingButton
                          type="button"
                          className={
                            bookingRow.offline_receipt_status === 'submitted'
                              ? 'btn btn-primary'
                              : 'btn btn-secondary'
                          }
                          autoLoading={false}
                          onClick={() =>
                            router.push(
                              bookingRow.offline_receipt_status === 'submitted'
                                ? `/admin/bookings/${bookingRow.id}#lipa-namba-receipt`
                                : `/admin/bookings/${bookingRow.id}`
                            )
                          }
                        >
                          {bookingRow.offline_receipt_status === 'submitted'
                            ? 'Review receipt'
                            : 'Manage'}
                        </LoadingButton>
                        {bookingRow.status === 'confirmed' &&
                          !bookingRow.ticket_sent_at && (
                            <LoadingButton
                              type="button"
                              className="btn btn-secondary"
                              autoLoading={false}
                              loading={resendingTicketBookingId === bookingRow.id}
                              loadingLabel="Sending…"
                              disabled={
                                resendingTicketBookingId !== null &&
                                resendingTicketBookingId !== bookingRow.id
                              }
                              onClick={() => resendTicketEmailForBooking(bookingRow)}
                            >
                              Resend ticket
                            </LoadingButton>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
                {bookingRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">
                      No bookings found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BookingCreateForm adminToken={adminToken} onCreateBooking={refreshBookingList} />
    </>
  );
}