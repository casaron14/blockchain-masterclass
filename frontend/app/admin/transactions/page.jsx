'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetchTransactionTracking } from '@/lib/api';
import { useAdmin } from '@/context/AdminContext';
import LoadingButton from '@/components/LoadingButton';
import TableLoadingSkeleton from '@/components/TableLoadingSkeleton';
import AdminSessionLoading from '@/components/AdminSessionLoading';
import {
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_LIPANAMBA,
  PAYMENT_METHOD_USDT_BEP20,
  defaultEventConfig,
} from '@/lib/eventConfig';
import TransactionStageTimeline from '@/components/TransactionStageTimeline';
import TransactionDetailPanel from '@/components/TransactionDetailPanel';
import { buildCollectedAmountTotals } from '@/lib/adminTransactionTotals';
import {
  formatAdminAmount,
  formatAdminAmountWithCurrency,
  formatAdminStatusLabel,
  formatAdminTimestamp,
} from '@/lib/adminFormatting';

const { currency, cryptoCurrency, cryptoNetwork } = defaultEventConfig;

const METHOD_FILTER_OPTIONS = [
  { value: '', label: 'All methods' },
  { value: PAYMENT_METHOD_LIPANAMBA, label: 'Lipa Namba' },
  { value: PAYMENT_METHOD_USDT_BEP20, label: `${cryptoCurrency} (${cryptoNetwork})` },
  // Retired method: kept in the filter so historical transactions stay
  // reachable and auditable.
  { value: PAYMENT_METHOD_AZAMPESA, label: 'AzamPesa (retired)' },
];

const PAYMENT_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All payment statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'initiating', label: 'Initiating' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'failed', label: 'Failed' },
  { value: 'expired', label: 'Expired' },
];

function formatDisplayTimestamp(rawTimestamp) {
  return formatAdminTimestamp(rawTimestamp);
}

function renderPaymentMethodLabel(paymentMethod) {
  if (paymentMethod === PAYMENT_METHOD_AZAMPESA) {
    return 'AzamPesa (retired)';
  }
  if (paymentMethod === PAYMENT_METHOD_LIPANAMBA) {
    return 'Lipa Namba';
  }
  return `${cryptoCurrency} (${cryptoNetwork})`;
}

function renderExpectedAmount(transaction) {
  if (transaction.payment_method !== PAYMENT_METHOD_USDT_BEP20) {
    return formatAdminAmountWithCurrency(transaction.amount_expected, currency);
  }
  return `${formatAdminAmount(transaction.amount_usdt)} ${cryptoCurrency}`;
}

export default function AdminTransactionsPage() {
  const router = useRouter();
  const { adminToken, adminUser, isSessionRestoring, isLoggingOut, logoutAdminSession } = useAdmin();

  const [transactionRows, setTransactionRows] = useState([]);
  const [methodFilter, setMethodFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('');
  const [expandedTransactionPaymentKey, setExpandedTransactionPaymentKey] = useState(null);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [listError, setListError] = useState(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);

  const refreshTransactionList = useCallback(() => {
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
    setIsLoadingTransactions(true);
    setListError(null);
    adminFetchTransactionTracking({
      methodFilter: methodFilter || undefined,
      paymentStatusFilter: paymentStatusFilter || undefined,
      adminToken,
    })
      .then((responseBody) => {
        setTransactionRows(responseBody.transactions || []);
      })
      .catch((error) => {
        setListError(error.message || 'Transactions could not be loaded.');
      })
      .finally(() => setIsLoadingTransactions(false));
  }, [isSessionRestoring, adminToken, methodFilter, paymentStatusFilter, listRefreshKey, router]);

  function toggleExpandedTransaction(paymentKey) {
    setExpandedTransactionPaymentKey((currentExpandedKey) =>
      currentExpandedKey === paymentKey ? null : paymentKey
    );
  }

  if (isSessionRestoring) {
    return <AdminSessionLoading />;
  }

  if (!adminToken) {
    return null;
  }

  const pendingTransactionCount = transactionRows.filter((transactionRow) =>
    ['pending', 'initiating'].includes(transactionRow.payment_status)
  ).length;
  const confirmedTransactionCount = transactionRows.filter(
    (transactionRow) => transactionRow.payment_status === 'confirmed'
  ).length;
  const failedTransactionCount = transactionRows.filter(
    (transactionRow) =>
      transactionRow.payment_status === 'failed' ||
      transactionRow.payment_status === 'expired'
  ).length;
  const collectedAmountTotals = buildCollectedAmountTotals(transactionRows, {
    localCurrencyCode: currency,
    cryptoCurrencyCode: cryptoCurrency,
    cryptoPaymentMethod: PAYMENT_METHOD_USDT_BEP20,
  });
  const nonZeroCollectedAmountTotals = collectedAmountTotals.filter(
    ({ totalAmount }) => totalAmount > 0
  );

  return (
    <>
      <section className="card">
        <div className="admin-toolbar">
          <div>
            <h2 className="card__title">Transactions</h2>
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
        </div>

        <div className="admin-filter-row">
          <label className="field">
            <span>Payment method</span>
            <select
              value={methodFilter}
              onChange={(event) => setMethodFilter(event.target.value)}
            >
              {METHOD_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Payment status</span>
            <select
              value={paymentStatusFilter}
              onChange={(event) => setPaymentStatusFilter(event.target.value)}
            >
              {PAYMENT_STATUS_FILTER_OPTIONS.map((option) => (
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
            loading={isLoadingTransactions}
            loadingLabel="Refreshing…"
            onClick={refreshTransactionList}
          >
            Refresh
          </LoadingButton>
        </div>

        <div className="tx-summary-row">
          <span className={`tx-summary-chip ${pendingTransactionCount > 0 ? 'pending' : ''}`}>
            {pendingTransactionCount} pending / initiating
          </span>
          <span className={`tx-summary-chip ${confirmedTransactionCount > 0 ? 'confirmed' : ''}`}>
            {confirmedTransactionCount} confirmed
          </span>
          <span className={`tx-summary-chip ${failedTransactionCount > 0 ? 'failed' : ''}`}>
            {failedTransactionCount} failed / expired
          </span>
          {nonZeroCollectedAmountTotals.map(({ currencyCode, totalAmount }) => (
            <span key={currencyCode} className="tx-summary-chip collected">
              {formatAdminAmountWithCurrency(totalAmount, currencyCode)} collected
            </span>
          ))}
          {nonZeroCollectedAmountTotals.length === 0 && (
            <span className="tx-summary-chip collected">
              {formatAdminAmountWithCurrency(0, currency)} collected
            </span>
          )}
        </div>

        {listError && <p className="error-banner">{listError}</p>}
        {isLoadingTransactions ? (
          <TableLoadingSkeleton
            tableKind="transactions"
            rowCount={4}
            statusLabel="Fetching transaction records…"
          />
        ) : (
          <div className="table-scroll">
            <table className="admin-table tx-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Ref</th>
                  <th>Attendee</th>
                  <th>Amount</th>
                  <th>Payment status</th>
                  <th>Booking</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {transactionRows.map((transactionRow) => {
                  const paymentKey = transactionRow.payment_id;
                  const isExpanded = expandedTransactionPaymentKey === paymentKey;
                  return (
                    <TransactionRow
                      key={paymentKey}
                      transactionRow={transactionRow}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleExpandedTransaction(paymentKey)}
                      onManageBooking={() =>
                        router.push(`/admin/bookings/${transactionRow.booking_id}`)
                      }
                    />
                  );
                })}
                {transactionRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No transactions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function TransactionRow({
  transactionRow,
  isExpanded,
  onToggleExpand,
  onManageBooking,
}) {
  return (
    <>
      <tr
        className={`tx-table-row ${isExpanded ? 'expanded' : ''}`}
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
      >
        <td>
          <span className="tx-method-label">{renderPaymentMethodLabel(transactionRow.payment_method)}</span>
        </td>
        <td>
          <code>{transactionRow.booking_ref}</code>
        </td>
        <td>
          <strong>{transactionRow.full_name}</strong>
        </td>
        <td>{renderExpectedAmount(transactionRow)}</td>
        <td>
          <span className={`status-chip ${transactionRow.payment_status}`}>
            {formatAdminStatusLabel(transactionRow.payment_status)}
          </span>
        </td>
        <td>{formatAdminStatusLabel(transactionRow.booking_status)}</td>
        <td>{formatDisplayTimestamp(transactionRow.booking_created_at)}</td>
      </tr>
      {isExpanded && (
        <tr className="tx-expanded-row">
          <td colSpan={7}>
            <div className="tx-expanded-inner">
              <div className="tx-expanded-actions">
                <LoadingButton
                  type="button"
                  className="btn btn-secondary"
                  loadingLabel="Opening booking…"
                  onClick={onManageBooking}
                >
                  Manage booking
                </LoadingButton>
              </div>
              <div className="tx-expanded-columns">
                <TransactionStageTimeline stages={transactionRow.stages} />
                <TransactionDetailPanel transaction={transactionRow} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}