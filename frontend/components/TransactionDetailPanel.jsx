'use client';

import {
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_LIPANAMBA,
  PAYMENT_METHOD_USDT_BEP20,
  defaultEventConfig,
} from '@/lib/eventConfig';
import {
  formatAdminAmount,
  formatAdminAmountWithCurrency,
  formatAdminStatusLabel,
  formatAdminTimestamp,
} from '@/lib/adminFormatting';

const { currency, cryptoCurrency, cryptoNetwork } = defaultEventConfig;

function DetailItem({ label, value }) {
  return (
    <div className="admin-detail-item">
      <strong>{label}</strong>
      <span>{value || '—'}</span>
    </div>
  );
}

function formatTimestamp(rawTimestamp) {
  if (!rawTimestamp) {
    return '—';
  }
  return formatAdminTimestamp(rawTimestamp);
}

function ShortRecord({ label, value }) {
  return (
    <div className="tx-record">
      <strong>{label}</strong>
      <code>{value || '—'}</code>
    </div>
  );
}

function RecordListSection({ title, records, renderRecord, emptyLabel }) {
  return (
    <section className="tx-sub-block">
      <h3 className="tx-sub-block__title">{title}</h3>
      {records.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <div className="tx-record-list">
          {records.map((record, recordIndex) => (
            <div className="tx-record" key={recordIndex}>
              {renderRecord(record)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function renderAzamPesaRecords({ azampesaTransactions, paymentWebhooks }) {
  return (
    <>
      <RecordListSection
        title="AzamPesa STK transactions"
        records={azampesaTransactions}
        emptyLabel="No AzamPesa STK transaction has been recorded yet."
        renderRecord={(azamTransaction) => (
          <>
            <ShortRecord label="Tx ID" value={azamTransaction.tx_id} />
            <ShortRecord label={`Value (${currency})`} value={azamTransaction.value} />
            <ShortRecord
              label="Confirmed at"
              value={formatTimestamp(azamTransaction.confirmed_at)}
            />
          </>
        )}
      />

      <RecordListSection
        title="Inbound AzamPay webhooks"
        records={paymentWebhooks}
        emptyLabel="No AzamPay webhook has been received yet."
        renderRecord={(webhook) => (
          <>
            <ShortRecord label="Status" value={webhook.payload.transactionstatus} />
            <ShortRecord
              label="Received at"
              value={formatTimestamp(webhook.received_at)}
            />
            <ShortRecord label="Payload" value={JSON.stringify(webhook.payload)} />
          </>
        )}
      />
    </>
  );
}

function renderUsdtRecords({
  observedDeposits,
  verifiedTransactions,
  verificationErrors,
  sweeps,
  treasuryLedgerEntries,
}) {
  return (
    <>
      <RecordListSection
        title="Observed deposits"
        records={observedDeposits}
        emptyLabel={`No ${cryptoCurrency} transfer has been observed at the deposit address yet.`}
        renderRecord={(deposit) => (
          <>
            <ShortRecord label="Tx hash" value={deposit.tx_hash} />
            <ShortRecord label="From" value={deposit.from_address} />
            <ShortRecord label="Amount" value={`${deposit.amount} ${cryptoCurrency}`} />
            <ShortRecord label="Block" value={deposit.block_number} />
            <ShortRecord label="Confirmations" value={deposit.confirmations} />
            <ShortRecord label="Matched at" value={formatTimestamp(deposit.matched_at)} />
          </>
        )}
      />

      <RecordListSection
        title="Verified blockchain transactions"
        records={verifiedTransactions}
        emptyLabel="No transfer has been verified on the blockchain yet."
        renderRecord={(verifiedTransaction) => (
          <>
            <ShortRecord label="Tx hash" value={verifiedTransaction.tx_hash} />
            <ShortRecord label="From" value={verifiedTransaction.from_address} />
            <ShortRecord label="To" value={verifiedTransaction.to_address} />
            <ShortRecord label="Value" value={`${verifiedTransaction.value} ${cryptoCurrency}`} />
            <ShortRecord label="Block" value={verifiedTransaction.block_number} />
            <ShortRecord
              label="Confirmed at"
              value={formatTimestamp(verifiedTransaction.confirmed_at)}
            />
          </>
        )}
      />

      <RecordListSection
        title="Verification errors"
        records={verificationErrors}
        emptyLabel="No blockchain verification errors recorded."
        renderRecord={(verificationError) => (
          <>
            <ShortRecord label="Tx hash" value={verificationError.tx_hash} />
            <ShortRecord label="Error" value={verificationError.error_message} />
            <ShortRecord label="Received at" value={formatTimestamp(verificationError.received_at)} />
          </>
        )}
      />

      <RecordListSection
        title="Sweeps"
        records={sweeps}
        emptyLabel="No sweep has been performed for this deposit."
        renderRecord={(sweep) => (
          <>
            <ShortRecord label="Status" value={sweep.status} />
            <ShortRecord label="Tx hash" value={sweep.tx_hash} />
            <ShortRecord label="Amount" value={`${sweep.amount} ${cryptoCurrency}`} />
            <ShortRecord label="Failure reason" value={sweep.failure_reason} />
            <ShortRecord label="Updated at" value={formatTimestamp(sweep.updated_at)} />
          </>
        )}
      />

      <RecordListSection
        title="Treasury ledger entries"
        records={treasuryLedgerEntries}
        emptyLabel="No treasury sweep has been recorded yet."
        renderRecord={(ledgerEntry) => (
          <>
            <ShortRecord label="Tx hash" value={ledgerEntry.tx_hash} />
            <ShortRecord label="Amount" value={`${ledgerEntry.amount} ${cryptoCurrency}`} />
            <ShortRecord label="Recorded at" value={formatTimestamp(ledgerEntry.recorded_at)} />
          </>
        )}
      />
    </>
  );
}

function renderLipaNambaRecords({ offlineReceiptFileName, offlineReceiptStatus }) {
  return (
    <RecordListSection
      title="Lipa Namba receipt"
      records={offlineReceiptFileName ? [{ offlineReceiptFileName, offlineReceiptStatus }] : []}
      emptyLabel="No payment receipt has been uploaded yet."
      renderRecord={(receiptRecord) => (
        <>
          <ShortRecord label="File name" value={receiptRecord.offlineReceiptFileName} />
          <ShortRecord label="Review status" value={receiptRecord.offlineReceiptStatus} />
        </>
      )}
    />
  );
}

export default function TransactionDetailPanel({ transaction }) {
  const isAzamPesa = transaction.payment_method === PAYMENT_METHOD_AZAMPESA;
  const isLipaNamba = transaction.payment_method === PAYMENT_METHOD_LIPANAMBA;
  const isUsdt = transaction.payment_method === PAYMENT_METHOD_USDT_BEP20;

  const paymentMethodLabel = isAzamPesa
    ? 'AzamPesa (retired)'
    : isLipaNamba
      ? 'Lipa Namba'
      : `${cryptoCurrency} (${cryptoNetwork})`;

  return (
    <div className="tx-detail-panel">
      <div className="admin-detail-grid">
        <DetailItem label="Booking ref" value={transaction.booking_ref} />
        <DetailItem label="Attendee" value={transaction.full_name} />
        <DetailItem label="Phone" value={transaction.phone_number} />
        <DetailItem label="Email" value={transaction.email} />
        <DetailItem
          label="Booking status"
          value={formatAdminStatusLabel(transaction.booking_status)}
        />
        <DetailItem label="Referral source" value={transaction.utm_source} />
        <DetailItem label="Booking created" value={formatTimestamp(transaction.booking_created_at)} />
        <DetailItem label="Seat expires" value={formatTimestamp(transaction.booking_expires_at)} />
      </div>

      <div className="tx-sub-block">
        <h3 className="tx-sub-block__title">Payment details</h3>
        <div className="admin-detail-grid">
          <DetailItem label="Method" value={paymentMethodLabel} />
          <DetailItem
            label="Amount expected"
            value={
              isUsdt
                ? `${formatAdminAmount(transaction.amount_usdt)} ${cryptoCurrency}`
                : formatAdminAmountWithCurrency(transaction.amount_expected, currency)
            }
          />
          <DetailItem
            label="Payment status"
            value={formatAdminStatusLabel(transaction.payment_status)}
          />
          <DetailItem label="Reference ID" value={transaction.reference_id} />
          <DetailItem label="Initiated at" value={formatTimestamp(transaction.payment_initiated_at)} />
          <DetailItem
            label="Confirmed at"
            value={formatTimestamp(transaction.payment_confirmed_at)}
          />
        </div>
      </div>

      {isUsdt && (
        <div className="tx-sub-block">
          <h3 className="tx-sub-block__title">{cryptoCurrency} order</h3>
          <div className="admin-detail-grid">
            <DetailItem label="Order ID" value={transaction.order_id} />
            <DetailItem label="Order status" value={transaction.order_status} />
            <DetailItem label="Derivation index" value={transaction.derivation_index} />
            <DetailItem label="Order created" value={formatTimestamp(transaction.order_created_at)} />
            <DetailItem label="Order expires" value={formatTimestamp(transaction.order_expires_at)} />
          </div>
          <div className="tx-full-width-detail">
            <DetailItem label="Deposit address" value={transaction.deposit_address} />
            <DetailItem
              label="Address assigned"
              value={formatTimestamp(transaction.deposit_address_created_at)}
            />
          </div>
        </div>
      )}

      <div className="tx-sub-block">
        <h3 className="tx-sub-block__title">Stage records</h3>
        {isAzamPesa &&
          renderAzamPesaRecords({
            azampesaTransactions: transaction.azampesa_transactions,
            paymentWebhooks: transaction.payment_webhooks,
          })}
        {isLipaNamba &&
          renderLipaNambaRecords({
            offlineReceiptFileName: transaction.offline_receipt_original_file_name,
            offlineReceiptStatus: transaction.offline_receipt_status,
          })}
        {isUsdt &&
          renderUsdtRecords({
            observedDeposits: transaction.observed_deposits,
            verifiedTransactions: transaction.verified_transactions,
            verificationErrors: transaction.verification_errors,
            sweeps: transaction.sweeps,
            treasuryLedgerEntries: transaction.treasury_ledger_entries,
          })}
      </div>
    </div>
  );
}