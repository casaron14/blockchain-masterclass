'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminConfirmBooking,
  adminFetchBookingDetail,
  adminResendTicketConfirmationEmail,
  adminUpdateBooking,
} from '@/lib/api';
import { useAdmin } from '@/context/AdminContext';
import LoadingButton from '@/components/LoadingButton';
import OfflinePaymentReceiptPreview from '@/components/OfflinePaymentReceiptPreview';
import AdminSessionLoading from '@/components/AdminSessionLoading';
import RecordLoadingSkeleton from '@/components/RecordLoadingSkeleton';
import { defaultEventConfig } from '@/lib/eventConfig';
import {
  formatAdminAmountWithCurrency,
  formatAdminStatusLabel,
  formatAdminTimestamp,
} from '@/lib/adminFormatting';
import { resolveBookingConfirmationMessage } from '@/lib/adminBookingConfirmation';

const BOOKING_STATUS_OPTIONS = ['pending', 'confirmed', 'cancelled', 'expired'];

function DetailItem({ label, value }) {
  return (
    <div className="admin-detail-item">
      <strong>{label}</strong>
      <span>{value || '—'}</span>
    </div>
  );
}

export default function AdminBookingDetailPage({ params }) {
  const router = useRouter();
  const { adminToken, isSessionRestoring } = useAdmin();
  const { id } = use(params);
  const bookingId = Number(id);

  const [bookingDetail, setBookingDetail] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeEmail, setAttendeeEmail] = useState('');
  const [attendeePhone, setAttendeePhone] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [bookingStatus, setBookingStatus] = useState('');

  const [attendeeSaveMessage, setAttendeeSaveMessage] = useState(null);
  const [attendeeSaveTone, setAttendeeSaveTone] = useState('info');
  const [bookingConfirmationMessage, setBookingConfirmationMessage] = useState(null);
  const [bookingConfirmationTone, setBookingConfirmationTone] = useState('info');
  const [isSavingBooking, setIsSavingBooking] = useState(false);
  const [isConfirmingBooking, setIsConfirmingBooking] = useState(false);
  const [isResendingTicketEmail, setIsResendingTicketEmail] = useState(false);
  const [ticketResendMessage, setTicketResendMessage] = useState(null);
  const [ticketResendTone, setTicketResendTone] = useState('info');
  const hasScrolledToReceiptRef = useRef(false);

  useEffect(() => {
    if (isSessionRestoring) {
      return;
    }
    if (!adminToken) {
      router.replace('/admin/login');
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    hasScrolledToReceiptRef.current = false;
    adminFetchBookingDetail(bookingId, adminToken)
      .then((detailPayload) => {
        setBookingDetail(detailPayload);
        setAttendeeName(detailPayload.booking.full_name);
        setAttendeeEmail(detailPayload.booking.email);
        setAttendeePhone(detailPayload.booking.phone_number);
        setReferralSource(detailPayload.booking.utm_source || '');
        setBookingStatus(detailPayload.booking.status);
      })
      .catch((error) => {
        setLoadError(error.message || 'Booking could not be loaded.');
      })
      .finally(() => setIsLoading(false));
  }, [isSessionRestoring, adminToken, bookingId, router]);

  function applyRefreshedBookingDetail(refreshedDetail) {
    setBookingDetail(refreshedDetail);
    setBookingStatus(refreshedDetail.booking.status);
  }

  // The bookings list sends the admin straight to the receipt section. The
  // section only exists after the detail request finishes, so the browser's
  // own hash jump runs too early and this finishes the job.
  useEffect(() => {
    if (
      hasScrolledToReceiptRef.current ||
      isLoading ||
      !bookingDetail ||
      window.location.hash !== '#lipa-namba-receipt'
    ) {
      return;
    }
    const receiptSection = document.getElementById('lipa-namba-receipt');
    if (receiptSection) {
      receiptSection.scrollIntoView({ block: 'start' });
      hasScrolledToReceiptRef.current = true;
    }
  }, [isLoading, bookingDetail]);

  async function handleSaveBooking() {
    setAttendeeSaveMessage(null);
    setBookingConfirmationMessage(null);
    setIsSavingBooking(true);
    try {
      const isAskingForConfirmation =
        bookingStatus === 'confirmed' && bookingDetail.booking.status !== 'confirmed';
      const isChangingBookingStatus =
        !isAskingForConfirmation && bookingStatus !== bookingDetail.booking.status;

      const updatedBooking = await adminUpdateBooking(
        bookingId,
        {
          full_name: attendeeName.trim(),
          email: attendeeEmail.trim(),
          phone_number: attendeePhone.trim(),
          utm_source: referralSource.trim(),
          ...(isChangingBookingStatus ? { status: bookingStatus } : {}),
        },
        adminToken
      );

      setAttendeeSaveTone('success');
      setAttendeeSaveMessage('Booking updated successfully.');

      if (isAskingForConfirmation) {
        // Choosing "Confirmed" must run the same final step as the confirm
        // button: confirm the seat, record the payment and release the ticket.
        const confirmationResult = await adminConfirmBooking(bookingId, adminToken);
        const confirmationMessage = resolveBookingConfirmationMessage(confirmationResult);
        const refreshedDetail = await adminFetchBookingDetail(bookingId, adminToken);
        applyRefreshedBookingDetail(refreshedDetail);
        setBookingConfirmationTone(confirmationMessage.tone);
        setBookingConfirmationMessage(confirmationMessage.message);
        return;
      }

      setBookingStatus(updatedBooking.booking.status);
      setBookingDetail((previousDetail) => ({
        ...previousDetail,
        booking: { ...previousDetail.booking, ...updatedBooking.booking },
      }));
    } catch (error) {
      setAttendeeSaveTone('error');
      setAttendeeSaveMessage(error.message || 'Booking could not be updated.');
      setBookingStatus(bookingDetail.booking.status);
    } finally {
      setIsSavingBooking(false);
    }
  }

  // The single final step: seat, payment and ticket are handled together.
  async function handleConfirmBooking() {
    setBookingConfirmationMessage(null);
    setIsConfirmingBooking(true);
    try {
      const confirmationResult = await adminConfirmBooking(bookingId, adminToken);
      const refreshedDetail = await adminFetchBookingDetail(bookingId, adminToken);
      applyRefreshedBookingDetail(refreshedDetail);

      const confirmationMessage = resolveBookingConfirmationMessage(confirmationResult);
      setBookingConfirmationTone(confirmationMessage.tone);
      setBookingConfirmationMessage(confirmationMessage.message);
    } catch (error) {
      setBookingConfirmationTone('error');
      setBookingConfirmationMessage(error.message || 'Booking could not be confirmed.');
    } finally {
      setIsConfirmingBooking(false);
    }
  }

  // An admin can resend the confirmation email after the first successful
  // delivery. The API resolves the attendee email from the booking id and takes
  // a delivery lease, so repeated clicks cannot send at the same time.
  async function handleResendTicketEmail() {
    setTicketResendMessage(null);
    setIsResendingTicketEmail(true);
    try {
      await adminResendTicketConfirmationEmail(bookingId, adminToken);
      const refreshedDetail = await adminFetchBookingDetail(bookingId, adminToken);
      applyRefreshedBookingDetail(refreshedDetail);
      setTicketResendTone('success');
      setTicketResendMessage(
        `Ticket email resent to ${refreshedDetail.booking.email}.`
      );
    } catch (error) {
      setTicketResendTone('error');
      setTicketResendMessage(
        error.message || 'The ticket email could not be sent. Check the server log.'
      );
    } finally {
      setIsResendingTicketEmail(false);
    }
  }

  if (isSessionRestoring) {
    return <AdminSessionLoading statusLabel="Restoring your admin session…" />;
  }

  if (!adminToken) {
    return null;
  }

  if (loadError) {
    return (
      <>
        <p className="error-banner">{loadError}</p>
        <button type="button" className="btn btn-secondary" onClick={() => router.push('/admin')}>
          Back to bookings
        </button>
      </>
    );
  }

  if (isLoading || !bookingDetail) {
    return (
      <RecordLoadingSkeleton
        statusLabel="Opening the booking record…"
        sectionCount={2}
      />
    );
  }

  const { booking, payment, order, depositAddress, offlineReceipt, ticketDelivery } =
    bookingDetail;
  const isBookingConfirmed = booking.status === 'confirmed';
  const isBookingPaymentConfirmed = !payment || payment.status === 'confirmed';
  const isBookingFullyConfirmed = isBookingConfirmed && isBookingPaymentConfirmed;
  const isBookingCancelled = booking.status === 'cancelled';

  return (
    <>
      <section className="card">
        <div className="admin-toolbar">
          <div>
            <h2 className="card__title">
              Booking <code>{booking.ref}</code>
            </h2>
            <p className="admin-status">ID {booking.id}</p>
          </div>
          <div className="admin-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => router.push('/admin')}
            >
              Back to bookings
            </button>
            {!isBookingFullyConfirmed && !offlineReceipt && (
              <LoadingButton
                type="button"
                className="btn btn-primary"
                spinnerColor="#f2ede3"
                autoLoading={false}
                loading={isConfirmingBooking}
                loadingLabel="Confirming booking…"
                disabled={isBookingCancelled}
                onClick={handleConfirmBooking}
              >
                Confirm booking
              </LoadingButton>
            )}
            {isBookingConfirmed && (
              <LoadingButton
                type="button"
                className="btn btn-secondary"
                autoLoading={false}
                loading={isResendingTicketEmail}
                loadingLabel="Sending ticket…"
                onClick={handleResendTicketEmail}
              >
                Resend ticket email
              </LoadingButton>
            )}
          </div>
        </div>

        <div className="admin-detail-grid">
          <DetailItem label="Status" value={formatAdminStatusLabel(booking.status)} />
          <DetailItem label="Created" value={formatAdminTimestamp(booking.created_at)} />
          <DetailItem
            label="Seat expires"
            value={booking.expires_at ? formatAdminTimestamp(booking.expires_at) : '—'}
          />
          <DetailItem
            label="Payment method"
            value={payment?.payment_method || 'none'}
          />
          <DetailItem
            label="Payment status"
            value={payment?.status ? formatAdminStatusLabel(payment.status) : '—'}
          />
          <DetailItem
            label="Amount expected"
            value={
              payment?.amount_expected
                ? formatAdminAmountWithCurrency(payment.amount_expected, defaultEventConfig.currency)
                : '—'
            }
          />
          <DetailItem
            label="Payment confirmed at"
            value={payment?.confirmed_at ? formatAdminTimestamp(payment.confirmed_at) : '—'}
          />
          <DetailItem
            label="Ticket last sent at"
            value={formatAdminTimestamp(
              ticketDelivery?.sent_at || booking.ticket_sent_at
            )}
          />
          <DetailItem
            label="Ticket delivery status"
            value={
              ticketDelivery?.status
                ? formatAdminStatusLabel(ticketDelivery.status)
                : '—'
            }
          />
        </div>

        {ticketResendMessage && (
          <p className={`status-message ${ticketResendTone}`}>{ticketResendMessage}</p>
        )}

        {order && (
          <div className="admin-detail-grid">
            <DetailItem label="Order ID" value={order.id} />
            <DetailItem label="Order status" value={formatAdminStatusLabel(order.status)} />
            <DetailItem label="Order amount (USDT)" value={order.amount_usdt} />
            <DetailItem label="Deposit address" value={depositAddress?.address || '—'} />
          </div>
        )}

        {isBookingCancelled && !isBookingConfirmed && (
          <p className="muted">
            This booking is cancelled. Set the booking status back to pending below before
            confirming it.
          </p>
        )}

        {!offlineReceipt && bookingConfirmationMessage && (
          <p className={`status-message ${bookingConfirmationTone}`}>
            {bookingConfirmationMessage}
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Attendee details</h2>
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            handleSaveBooking();
          }}
          noValidate
        >
          <label className="field">
            <span>Full name</span>
            <input
              type="text"
              value={attendeeName}
              onChange={(event) => setAttendeeName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              value={attendeeEmail}
              onChange={(event) => setAttendeeEmail(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Phone number</span>
            <input
              type="tel"
              value={attendeePhone}
              onChange={(event) => setAttendeePhone(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Referral username or source</span>
            <input
              type="text"
              value={referralSource}
              onChange={(event) => setReferralSource(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Booking status</span>
            <select
              value={bookingStatus}
              onChange={(event) => setBookingStatus(event.target.value)}
            >
              {BOOKING_STATUS_OPTIONS.map((statusOption) => (
                <option key={statusOption} value={statusOption}>
                  {formatAdminStatusLabel(statusOption)}
                </option>
              ))}
            </select>
            <small className="muted">
              Choosing Confirmed runs the final step: seat, payment and ticket together.
            </small>
          </label>

          {attendeeSaveMessage && (
            <p className={`status-message ${attendeeSaveTone}`}>{attendeeSaveMessage}</p>
          )}

          <LoadingButton
            type="submit"
            className="btn btn-primary"
            spinnerColor="#f2ede3"
            autoLoading={false}
            loading={isSavingBooking}
            loadingLabel="Saving booking…"
          >
            Save booking
          </LoadingButton>
        </form>
      </section>

      {(offlineReceipt || payment?.payment_method === 'lipanamba') && (
        <section className="card receipt-review-anchor" id="lipa-namba-receipt">
          <h2 className="card__title">Lipa Namba receipt</h2>
          {offlineReceipt ? (
            <>
              <div className="admin-detail-grid">
                <DetailItem
                  label="Receipt status"
                  value={formatAdminStatusLabel(offlineReceipt.status)}
                />
                <DetailItem label="File name" value={offlineReceipt.originalFileName} />
                <DetailItem
                  label="Uploaded at"
                  value={formatAdminTimestamp(offlineReceipt.uploadedAt)}
                />
                <DetailItem
                  label="Reviewed at"
                  value={
                    offlineReceipt.reviewedAt
                      ? formatAdminTimestamp(offlineReceipt.reviewedAt)
                      : '—'
                  }
                />
              </div>

              <p className="muted">
                Check the uploaded receipt against the Lipa Namba statement, then confirm the
                booking. Confirming records the payment and makes the ticket downloadable from the
                booking lookup.
              </p>

              <OfflinePaymentReceiptPreview
                bookingId={bookingId}
                adminToken={adminToken}
                fileName={offlineReceipt.originalFileName}
              >
                {!isBookingFullyConfirmed && (
                  <LoadingButton
                    type="button"
                    className="btn btn-primary"
                    spinnerColor="#f2ede3"
                    autoLoading={false}
                    loading={isConfirmingBooking}
                    loadingLabel="Confirming booking…"
                    disabled={isBookingCancelled}
                    onClick={handleConfirmBooking}
                  >
                    Confirm booking
                  </LoadingButton>
                )}
              </OfflinePaymentReceiptPreview>

              {isBookingCancelled && (
                <p className="error-banner">
                  This booking is cancelled. Set the booking status back to pending above before
                  confirming it.
                </p>
              )}

              {bookingConfirmationMessage && (
                <p className={`status-message ${bookingConfirmationTone}`}>
                  {bookingConfirmationMessage}
                </p>
              )}
            </>
          ) : (
            <p className="muted">No receipt has been uploaded for this booking yet.</p>
          )}
        </section>
      )}
    </>
  );
}
