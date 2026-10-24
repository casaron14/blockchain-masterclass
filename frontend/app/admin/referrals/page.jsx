'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminCreateReferrerInvite,
  adminDownloadReferralSummaryCsv,
  adminDownloadReferredClientsCsv,
  adminFetchReferralSummary,
  adminFetchReferredClients,
} from '@/lib/api';
import { useAdmin } from '@/context/AdminContext';
import LoadingButton from '@/components/LoadingButton';
import TableLoadingSkeleton from '@/components/TableLoadingSkeleton';
import AdminSessionLoading from '@/components/AdminSessionLoading';
import { formatAdminStatusLabel, formatAdminTimestamp } from '@/lib/adminFormatting';
import { buildReferralInviteUrl } from '@/lib/referralLink';

function readCurrentSiteOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function buildDisplayReferrerName(referralRow) {
  return referralRow.referrer_label || referralRow.referrer_code;
}

function ReferralInviteForm({ adminToken, onReferrerCreated }) {
  const [referrerName, setReferrerName] = useState('');
  const [referrerPhone, setReferrerPhone] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [createdReferrer, setCreatedReferrer] = useState(null);
  const [copyStatusMessage, setCopyStatusMessage] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    setCreatedReferrer(null);
    setCopyStatusMessage(null);
    setIsCreating(true);

    try {
      const createResult = await adminCreateReferrerInvite(
        {
          full_name: referrerName.trim(),
          phone_number: referrerPhone.trim(),
        },
        adminToken
      );
      setCreatedReferrer(createResult.referrer);
      setReferrerName('');
      setReferrerPhone('');
      onReferrerCreated();
    } catch (error) {
      setFormError(error.message || 'The referral link could not be created.');
    } finally {
      setIsCreating(false);
    }
  }

  async function copyInviteUrlToClipboard(inviteUrl) {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatusMessage('Invite link copied.');
    } catch {
      setCopyStatusMessage('Copy failed. Select the link and copy it manually.');
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">Create a referral link</h2>
      <p className="muted">
        Every booking that arrives through this link records the referrer&apos;s username, so the
        client list below is attributed automatically.
      </p>
      <form className="form" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>Referrer full name</span>
          <input
            type="text"
            value={referrerName}
            onChange={(event) => setReferrerName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Referrer phone number</span>
          <input
            type="tel"
            value={referrerPhone}
            onChange={(event) => setReferrerPhone(event.target.value)}
            autoComplete="off"
          />
        </label>
        {formError && <p className="error-banner">{formError}</p>}
        <LoadingButton
          type="submit"
          className="btn btn-primary"
          spinnerColor="#f2ede3"
          autoLoading={false}
          loading={isCreating}
          loadingLabel="Creating referral link…"
        >
          Create referral link
        </LoadingButton>
      </form>

      {createdReferrer && (
        <div className="referral-invite-result">
          <p>
            <strong>{createdReferrer.referrer_name}</strong> can share this link:
          </p>
          <label className="field">
            <span>Referral invite link</span>
            <input
              type="text"
              readOnly
              value={buildReferralInviteUrl(
                createdReferrer.referrer_code,
                readCurrentSiteOrigin()
              )}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <LoadingButton
            type="button"
            className="btn btn-secondary"
            autoLoading={false}
            onClick={() =>
              copyInviteUrlToClipboard(
                buildReferralInviteUrl(createdReferrer.referrer_code, readCurrentSiteOrigin())
              )
            }
          >
            Copy invite link
          </LoadingButton>
          {copyStatusMessage && <p className="muted">{copyStatusMessage}</p>}
        </div>
      )}
    </section>
  );
}

export default function AdminReferralsPage() {
  const router = useRouter();
  const { adminToken, isSessionRestoring } = useAdmin();

  const [referralRows, setReferralRows] = useState([]);
  const [isLoadingReferrals, setIsLoadingReferrals] = useState(false);
  const [listError, setListError] = useState(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);

  const [expandedReferralCode, setExpandedReferralCode] = useState(null);
  const [expandedClients, setExpandedClients] = useState([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  const [clientsError, setClientsError] = useState(null);
  const [downloadingReferralCode, setDownloadingReferralCode] = useState(null);
  const [isExportingSummary, setIsExportingSummary] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [copyLinkMessage, setCopyLinkMessage] = useState(null);

  const refreshReferralList = useCallback(() => {
    setListRefreshKey((currentKey) => currentKey + 1);
  }, []);

  useEffect(() => {
    if (isSessionRestoring) {
      return;
    }
    if (!adminToken) {
      router.replace('/admin/login');
      return;
    }

    setIsLoadingReferrals(true);
    setListError(null);
    adminFetchReferralSummary(adminToken)
      .then((responseBody) => {
        setReferralRows(responseBody.referrals || []);
      })
      .catch((error) => {
        setListError(error.message || 'Referrals could not be loaded.');
      })
      .finally(() => setIsLoadingReferrals(false));
  }, [isSessionRestoring, adminToken, listRefreshKey, router]);

  async function toggleReferredClientList(referralRow) {
    const referralCode = referralRow.referrer_code;

    if (expandedReferralCode === referralCode) {
      setExpandedReferralCode(null);
      setExpandedClients([]);
      setClientsError(null);
      return;
    }

    setExpandedReferralCode(referralCode);
    setExpandedClients([]);
    setClientsError(null);
    setIsLoadingClients(true);

    try {
      const responseBody = await adminFetchReferredClients(referralCode, adminToken);
      setExpandedClients(responseBody.clients || []);
    } catch (error) {
      setClientsError(error.message || 'Referred clients could not be loaded.');
    } finally {
      setIsLoadingClients(false);
    }
  }

  async function downloadReferredClientsCsv(referralRow) {
    setDownloadError(null);
    setDownloadingReferralCode(referralRow.referrer_code);

    try {
      await adminDownloadReferredClientsCsv(referralRow.referrer_code, adminToken);
    } catch (error) {
      setDownloadError(error.message || 'The client list could not be downloaded.');
    } finally {
      setDownloadingReferralCode(null);
    }
  }

  async function downloadReferralSummaryCsv() {
    setDownloadError(null);
    setIsExportingSummary(true);

    try {
      await adminDownloadReferralSummaryCsv(adminToken);
    } catch (error) {
      setDownloadError(error.message || 'The referral summary could not be downloaded.');
    } finally {
      setIsExportingSummary(false);
    }
  }

  async function copyReferralInviteLink(referralRow) {
    try {
      await navigator.clipboard.writeText(
        buildReferralInviteUrl(referralRow.referrer_code, readCurrentSiteOrigin())
      );
      setCopyLinkMessage(`Invite link for ${buildDisplayReferrerName(referralRow)} copied.`);
    } catch {
      setCopyLinkMessage('Copy failed. Select the link in the form and copy it manually.');
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
            <h2 className="card__title">Referrals</h2>
            <p className="muted">
              Each row is a referral username captured from a <code>?ref=</code> link. Download
              a referrer&apos;s client list as CSV to send it back to them.
            </p>
          </div>
          <LoadingButton
            type="button"
            className="btn btn-secondary"
            autoLoading={false}
            loading={isExportingSummary}
            loadingLabel="Preparing export…"
            onClick={downloadReferralSummaryCsv}
          >
            Export all referrals
          </LoadingButton>
          <LoadingButton
            type="button"
            className="btn btn-secondary"
            autoLoading={false}
            loading={isLoadingReferrals}
            loadingLabel="Refreshing…"
            onClick={refreshReferralList}
          >
            Refresh
          </LoadingButton>
        </div>

        {listError && <p className="error-banner">{listError}</p>}
        {downloadError && <p className="error-banner">{downloadError}</p>}
        {copyLinkMessage && <p className="muted">{copyLinkMessage}</p>}

        {isLoadingReferrals ? (
          <TableLoadingSkeleton
            tableKind="bookings"
            rowCount={4}
            statusLabel="Fetching referral records…"
          />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Referrer</th>
                  <th>Username</th>
                  <th>Contact</th>
                  <th>Referred</th>
                  <th>Confirmed</th>
                  <th>Pending</th>
                  <th>Latest</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {referralRows.map((referralRow) => (
                  <Fragment key={`${referralRow.referrer_code}-${referralRow.referrer_label}`}>
                    <ReferralRow
                      referralRow={referralRow}
                      isExpanded={expandedReferralCode === referralRow.referrer_code}
                      isDownloading={downloadingReferralCode === referralRow.referrer_code}
                      onToggleClients={() => toggleReferredClientList(referralRow)}
                      onDownloadCsv={() => downloadReferredClientsCsv(referralRow)}
                      onCopyInviteLink={() => copyReferralInviteLink(referralRow)}
                    />
                    {expandedReferralCode === referralRow.referrer_code && (
                      <tr>
                        <td colSpan={8}>
                          {isLoadingClients && (
                            <p className="muted">Loading referred clients…</p>
                          )}
                          {clientsError && <p className="error-banner">{clientsError}</p>}
                          {!isLoadingClients && !clientsError && (
                            <ReferredClientTable clientRows={expandedClients} />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {referralRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      No referral traffic has been recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ReferralInviteForm adminToken={adminToken} onReferrerCreated={refreshReferralList} />
    </>
  );
}

function ReferralRow({
  referralRow,
  isExpanded,
  isDownloading,
  onToggleClients,
  onDownloadCsv,
  onCopyInviteLink,
}) {
  const isRegisteredReferrer = Boolean(referralRow.referrer_phone);

  return (
    <tr>
      <td>
        <strong>{buildDisplayReferrerName(referralRow)}</strong>
        {!isRegisteredReferrer && (
          <>
            <br />
            <span className="status-chip pending">Unregistered source</span>
          </>
        )}
      </td>
      <td>
        <code>{referralRow.referrer_code}</code>
      </td>
      <td>{referralRow.referrer_phone || '—'}</td>
      <td>{referralRow.booking_count}</td>
      <td>
        <span className={`status-chip ${referralRow.confirmed_count > 0 ? 'confirmed' : ''}`}>
          {referralRow.confirmed_count}
        </span>
      </td>
      <td>{referralRow.pending_count}</td>
      <td>{formatAdminTimestamp(referralRow.latest_referral_at)}</td>
      <td>
        <div className="admin-row-actions">
          <LoadingButton
            type="button"
            className="btn btn-secondary"
            autoLoading={false}
            onClick={onToggleClients}
          >
            {isExpanded ? 'Hide clients' : 'View clients'}
          </LoadingButton>
          {isRegisteredReferrer && (
            <LoadingButton
              type="button"
              className="btn btn-secondary"
              autoLoading={false}
              onClick={onCopyInviteLink}
            >
              Copy link
            </LoadingButton>
          )}
          <LoadingButton
            type="button"
            className="btn btn-primary"
            autoLoading={false}
            loading={isDownloading}
            loadingLabel="Preparing…"
            onClick={onDownloadCsv}
          >
            Download CSV
          </LoadingButton>
        </div>
      </td>
    </tr>
  );
}

function ReferredClientTable({ clientRows }) {
  if (clientRows.length === 0) {
    return <p className="muted">No clients have booked through this referral code yet.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="admin-table admin-table--nested">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Client</th>
            <th>Contact</th>
            <th>Booking</th>
            <th>Payment</th>
            <th>Referred at</th>
          </tr>
        </thead>
        <tbody>
          {clientRows.map((clientRow) => (
            <tr key={clientRow.id}>
              <td>
                <code>{clientRow.ref}</code>
              </td>
              <td>{clientRow.full_name}</td>
              <td>
                {clientRow.email}
                <br />
                {clientRow.phone_number}
              </td>
              <td>
                <span className={`status-chip ${clientRow.status}`}>
                  {formatAdminStatusLabel(clientRow.status)}
                </span>
              </td>
              <td>
                <span className={`status-chip ${clientRow.payment_status || ''}`}>
                  {clientRow.payment_status
                    ? formatAdminStatusLabel(clientRow.payment_status)
                    : 'None'}
                </span>
              </td>
              <td>{formatAdminTimestamp(clientRow.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
