export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

import { DEFAULT_EVENT_SLUG } from '@/lib/eventConfig';
import { resolveOfflinePaymentReceiptFileExtension } from '@/lib/offlinePaymentReceiptPreview';
import { resolveCsvDownloadFileName } from '@/lib/downloadFileName';

async function readResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function request(path, options = {}) {
  const { headers: callerHeaders = {}, ...requestOptions } = options;

  // The caller headers (Authorization) must be merged with, not substituted
  // for, the JSON content type. Dropping it makes the backend body parser skip
  // the payload, so every admin write arrives without a body.
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...requestOptions,
    headers: {
      'Content-Type': 'application/json',
      ...callerHeaders,
    },
  });

  const responseBody = await readResponseJson(response);

  if (!response.ok) {
    const error = new Error(responseBody.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.responseBody = responseBody;
    throw error;
  }

  return responseBody;
}

export function fetchEventAvailability(eventSlug) {
  const query = eventSlug ? `?event=${encodeURIComponent(eventSlug)}` : '';
  return request(`/api/bookings/availability${query}`);
}

export function fetchEventConfigurationBySlug(eventSlug) {
  return request(`/api/events/${encodeURIComponent(eventSlug)}`);
}

export function createBookingRecord(attendeeDetails, eventSlug, turnstileToken) {
  const query = eventSlug ? `?event=${encodeURIComponent(eventSlug)}` : '';
  const requestBody = {
    ...attendeeDetails,
    ...(turnstileToken ? { cf_turnstile_response: turnstileToken } : {}),
  };
  return request(`/api/bookings${query}`, {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });
}

export async function fetchBookingRecordByReferenceCode(referenceCode) {
  const responseBody = await request(`/api/bookings/ref/${encodeURIComponent(referenceCode)}`);
  return responseBody.booking;
}

export async function lookupBookingBySearchValue(bookingSearchValue) {
  return request(`/api/bookings/lookup?q=${encodeURIComponent(bookingSearchValue)}`);
}

export async function reactivateExpiredBooking(bookingId, bookingReferenceCode) {
  const responseBody = await request(`/api/bookings/${bookingId}/reactivate`, {
    method: 'POST',
    body: JSON.stringify({ booking_ref: bookingReferenceCode }),
  });
  return responseBody.booking;
}

export async function fetchBookingRecordById(bookingId) {
  const responseBody = await request(`/api/bookings/${bookingId}`);
  return responseBody.booking;
}

export function createPaymentRecord({ bookingId, paymentMethod }) {
  return request('/api/payments', {
    method: 'POST',
    body: JSON.stringify({
      booking_id: bookingId,
      payment_method: paymentMethod,
    }),
  });
}

export async function fetchPaymentRecordById(paymentId) {
  const responseBody = await request(`/api/payments/${paymentId}`);
  return responseBody.payment;
}

export function fetchPaymentOverviewById(paymentId) {
  return request(`/api/payments/${paymentId}`);
}

export async function uploadLipaNambaPaymentReceipt(
  paymentId,
  receiptFile,
  bookingReferenceCode
) {
  const formData = new FormData();
  formData.append('booking_ref', bookingReferenceCode || '');
  formData.append('receipt', receiptFile);

  const response = await fetch(`${API_BASE_URL}/api/payments/${paymentId}/lipanamba-receipt`, {
    method: 'POST',
    body: formData,
  });
  const responseBody = await readResponseJson(response);

  if (!response.ok) {
    const error = new Error(
      responseBody.message || `Receipt upload failed with status ${response.status}`
    );
    error.status = response.status;
    error.responseBody = responseBody;
    throw error;
  }

  return responseBody;
}

export function initiateUsdtPayment(paymentId) {
  return request(`/api/payments/${paymentId}/initiate-usdt`, {
    method: 'POST',
  });
}

export function registerReferrerInvite(referrerDetails) {
  return request('/api/referrals/register', {
    method: 'POST',
    body: JSON.stringify(referrerDetails),
  });
}

export function buildTicketPdfDownloadUrl(bookingReferenceCode) {
  return `${API_BASE_URL}/api/tickets/${encodeURIComponent(bookingReferenceCode)}/download`;
}

export async function triggerTicketPdfDownload(bookingReferenceCode) {
  const ticketPdfUrl = buildTicketPdfDownloadUrl(bookingReferenceCode);
  const response = await fetch(ticketPdfUrl);

  if (!response.ok) {
    let errorMessage = `Download failed with status ${response.status}`;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.message || errorMessage;
    } catch {
      // response was not JSON; keep the generic status message
    }
    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
  }

  const pdfBlob = await response.blob();
  const blobDownloadUrl = window.URL.createObjectURL(pdfBlob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = blobDownloadUrl;
  downloadAnchor.download = `${DEFAULT_EVENT_SLUG}-ticket-${bookingReferenceCode}.pdf`;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  window.URL.revokeObjectURL(blobDownloadUrl);
}

export function adminLogin(username, password, turnstileToken) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      ...(turnstileToken ? { cf_turnstile_response: turnstileToken } : {}),
    }),
  });
}

export function adminVerifyTotp(temporaryToken, totpCode) {
  return request('/api/auth/verify-totp', {
    method: 'POST',
    body: JSON.stringify({ temporaryToken, code: totpCode }),
  });
}

export function adminBeginTotpSetup(temporaryToken) {
  return request('/api/auth/totp/setup', {
    method: 'POST',
    body: JSON.stringify({ temporaryToken }),
  });
}

export function adminConfirmTotpSetup(temporaryToken, totpCode) {
  return request('/api/auth/totp/confirm', {
    method: 'POST',
    body: JSON.stringify({ temporaryToken, code: totpCode }),
  });
}

export function adminLogout() {
  return request('/api/auth/logout', {
    method: 'POST',
  });
}

function buildAdminAuthorizationHeaders(adminToken) {
  return { Authorization: `Bearer ${adminToken}` };
}

export function adminFetchBookingList({ statusFilter, searchQuery, adminToken }) {
  const queryParameters = new URLSearchParams();
  if (statusFilter) {
    queryParameters.set('status', statusFilter);
  }
  if (searchQuery) {
    queryParameters.set('q', searchQuery);
  }
  const serializedQueryParameters = queryParameters.toString();
  const query = serializedQueryParameters ? `?${serializedQueryParameters}` : '';
  return request(`/api/admin/bookings${query}`, {
    headers: buildAdminAuthorizationHeaders(adminToken),
  });
}

export function adminFetchBookingDetail(bookingId, adminToken) {
  return request(`/api/admin/bookings/${bookingId}`, {
    headers: buildAdminAuthorizationHeaders(adminToken),
  });
}

export function adminCreateBooking(bookingDetails, adminToken) {
  return request('/api/admin/bookings', {
    method: 'POST',
    headers: buildAdminAuthorizationHeaders(adminToken),
    body: JSON.stringify(bookingDetails),
  });
}

export function adminUpdateBooking(bookingId, updateFields, adminToken) {
  return request(`/api/admin/bookings/${bookingId}`, {
    method: 'PUT',
    headers: buildAdminAuthorizationHeaders(adminToken),
    body: JSON.stringify(updateFields),
  });
}

export function adminConfirmBooking(bookingId, adminToken) {
  return request(`/api/admin/bookings/${bookingId}/confirm`, {
    method: 'POST',
    headers: buildAdminAuthorizationHeaders(adminToken),
  });
}

export function adminResendTicketConfirmationEmail(bookingId, adminToken) {
  return request(`/api/tickets/redeliver/${bookingId}`, {
    method: 'POST',
    headers: buildAdminAuthorizationHeaders(adminToken),
  });
}

export function adminSyncBookingsToGoogleSheet(adminToken) {
  return request('/api/admin/google-sheet/sync-bookings', {
    method: 'POST',
    headers: buildAdminAuthorizationHeaders(adminToken),
  });
}

export async function fetchAdminOfflinePaymentReceiptFile(bookingId, adminToken) {
  const response = await fetch(`${API_BASE_URL}/api/admin/bookings/${bookingId}/offline-receipt`, {
    headers: buildAdminAuthorizationHeaders(adminToken),
  });

  if (!response.ok) {
    const errorBody = await readResponseJson(response);
    const error = new Error(
      errorBody.message || `Receipt request failed with status ${response.status}`
    );
    error.status = response.status;
    error.responseBody = errorBody;
    throw error;
  }

  const receiptBlob = await response.blob();
  const receiptMimeType = response.headers.get('content-type') || receiptBlob.type;

  return { receiptBlob, receiptMimeType };
}

export async function adminDownloadOfflinePaymentReceipt(bookingId, adminToken) {
  const { receiptBlob, receiptMimeType } = await fetchAdminOfflinePaymentReceiptFile(
    bookingId,
    adminToken
  );
  const receiptBlobUrl = window.URL.createObjectURL(receiptBlob);
  const receiptFileExtension = resolveOfflinePaymentReceiptFileExtension(receiptMimeType);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = receiptBlobUrl;
  downloadAnchor.download = `lipanamba-receipt-${bookingId}.${receiptFileExtension}`;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(receiptBlobUrl), 1000);
}

export function adminFetchSummaryReport(adminToken) {
  return request('/api/admin/report', {
    headers: buildAdminAuthorizationHeaders(adminToken),
  });
}

export function adminFetchEventConfiguration(adminToken) {
  return request('/api/admin/configuration', {
    headers: buildAdminAuthorizationHeaders(adminToken),
  });
}

export function adminUpdateEventConfiguration(updateFields, adminToken) {
  return request('/api/admin/configuration', {
    method: 'PUT',
    headers: buildAdminAuthorizationHeaders(adminToken),
    body: JSON.stringify(updateFields),
  });
}

export function adminFetchTransactionTracking({ methodFilter, paymentStatusFilter, adminToken }) {
  const queryParams = [];
  if (methodFilter) {
    queryParams.push(`method=${encodeURIComponent(methodFilter)}`);
  }
  if (paymentStatusFilter) {
    queryParams.push(`payment_status=${encodeURIComponent(paymentStatusFilter)}`);
  }
  const query = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
  return request(`/api/admin/transactions${query}`, {
    headers: buildAdminAuthorizationHeaders(adminToken),
  });
}

export function adminFetchReferralSummary(adminToken) {
  return request('/api/admin/referrals', {
    headers: buildAdminAuthorizationHeaders(adminToken),
  });
}

export function adminCreateReferrerInvite(referrerDetails, adminToken) {
  return request('/api/admin/referrals', {
    method: 'POST',
    headers: buildAdminAuthorizationHeaders(adminToken),
    body: JSON.stringify(referrerDetails),
  });
}

export function adminFetchReferredClients(referrerCode, adminToken) {
  return request(
    `/api/admin/referrals/${encodeURIComponent(referrerCode)}/clients`,
    {
      headers: buildAdminAuthorizationHeaders(adminToken),
    }
  );
}

async function downloadAuthorizedCsvFile(downloadPath, adminToken, fallbackFileName) {
  const response = await fetch(`${API_BASE_URL}${downloadPath}`, {
    headers: buildAdminAuthorizationHeaders(adminToken),
  });

  if (!response.ok) {
    const errorBody = await readResponseJson(response);
    const error = new Error(
      errorBody.message || `Download failed with status ${response.status}`
    );
    error.status = response.status;
    error.responseBody = errorBody;
    throw error;
  }

  const csvBlob = await response.blob();
  const downloadFileName = resolveCsvDownloadFileName(
    response.headers.get('content-disposition'),
    fallbackFileName
  );
  const csvBlobUrl = window.URL.createObjectURL(csvBlob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = csvBlobUrl;
  downloadAnchor.download = downloadFileName;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(csvBlobUrl), 1000);

  return downloadFileName;
}

export function adminDownloadBookingsCsv(adminToken, { statusFilter, searchQuery } = {}) {
  const queryParameters = new URLSearchParams();
  if (statusFilter) {
    queryParameters.set('status', statusFilter);
  }
  if (searchQuery) {
    queryParameters.set('q', searchQuery);
  }
  const serializedQueryParameters = queryParameters.toString();
  const query = serializedQueryParameters ? `?${serializedQueryParameters}` : '';
  return downloadAuthorizedCsvFile(
    `/api/admin/bookings/export.csv${query}`,
    adminToken,
    'bookings.csv'
  );
}

export function adminDownloadReferralSummaryCsv(adminToken) {
  return downloadAuthorizedCsvFile(
    '/api/admin/referrals/export.csv',
    adminToken,
    'referral-summary.csv'
  );
}

export function adminDownloadReferredClientsCsv(referrerCode, adminToken) {
  return downloadAuthorizedCsvFile(
    `/api/admin/referrals/${encodeURIComponent(referrerCode)}/export.csv`,
    adminToken,
    `referred-clients-${referrerCode}.csv`
  );
}
