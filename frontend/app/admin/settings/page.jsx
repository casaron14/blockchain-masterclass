'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminFetchEventConfiguration,
  adminUpdateEventConfiguration,
} from '@/lib/api';
import { useAdmin } from '@/context/AdminContext';
import LoadingButton from '@/components/LoadingButton';
import RecordLoadingSkeleton from '@/components/RecordLoadingSkeleton';
import AdminSessionLoading from '@/components/AdminSessionLoading';
import { formatAdminTimestamp } from '@/lib/adminFormatting';

function formatUpdateTimestamp(rawTimestamp) {
  if (!rawTimestamp) {
    return 'Never edited';
  }
  return `Last saved ${formatAdminTimestamp(rawTimestamp)}`;
}

function parseOptionalNumber(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    return undefined;
  }
  const parsedNumber = Number(rawValue);
  return Number.isFinite(parsedNumber) ? parsedNumber : undefined;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const { adminToken, adminUser, isSessionRestoring, isLoggingOut, logoutAdminSession } = useAdmin();

  const [formValues, setFormValues] = useState(null);
  const [readOnlyDetails, setReadOnlyDetails] = useState(null);
  const [liveSeatCapacity, setLiveSeatCapacity] = useState(null);
  const [isLoadingConfiguration, setIsLoadingConfiguration] = useState(false);
  const [isSavingConfiguration, setIsSavingConfiguration] = useState(false);
  const [formError, setFormError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const loadConfiguration = useCallback(() => {
    if (isSessionRestoring) {
      return;
    }
    if (!adminToken) {
      router.replace('/admin/login');
      return;
    }
    setIsLoadingConfiguration(true);
    setFormError(null);
    adminFetchEventConfiguration(adminToken)
      .then((responseBody) => {
        const configuration = responseBody.configuration;
        setReadOnlyDetails({
          slug: configuration.slug,
          localCurrency: configuration.price.localCurrency,
          cryptoCurrency: configuration.price.cryptoCurrency,
          cryptoNetwork: configuration.price.cryptoNetwork,
          durationDays: configuration.durationDays,
          paymentMethods: configuration.paymentMethods,
          comingSoonPaymentMethods: configuration.comingSoonPaymentMethods ?? [],
        });
        setLiveSeatCapacity(responseBody.liveSeatCapacity || null);
        setFormValues({
          name: configuration.name,
          tagline: configuration.tagline,
          eventDate: configuration.event.date,
          eventLocation: configuration.event.location,
          priceLocalAmount: String(configuration.price.localAmount),
          priceCryptoAmount: String(configuration.price.cryptoAmount),
          priceRegularLocalAmount: String(configuration.price.regularLocalAmount),
          priceRegularCryptoAmount: String(configuration.price.regularCryptoAmount),
          seatCapacity: String(configuration.seatCapacity),
          phonePlaceholder: configuration.phonePlaceholder,
          contactSupportEmail: configuration.contact.supportEmail,
          contactSupportPhone: configuration.contact.supportPhone,
          contactAddressLine1: configuration.contact.addressLine1,
          contactAddressLine2: configuration.contact.addressLine2,
          contactPlatformName: configuration.contact.platformName,
          paymentLipaNambaNumber: configuration.payment?.lipaNambaNumber || '',
          paymentLipaNambaAccountName: configuration.payment?.lipaNambaAccountName || '',
        });
      })
      .catch((error) => {
        setFormError(error.message || 'Event configuration could not be loaded.');
      })
      .finally(() => setIsLoadingConfiguration(false));
  }, [isSessionRestoring, adminToken, router]);

  useEffect(loadConfiguration, [loadConfiguration]);

  function updateFormField(fieldKey, nextValue) {
    setFormValues((currentValues) => ({
      ...currentValues,
      [fieldKey]: nextValue,
    }));
  }

  function buildOverridePayload() {
    const payload = {
      name: formValues.name,
      tagline: formValues.tagline,
      event: {
        date: formValues.eventDate,
        location: formValues.eventLocation,
      },
      price: {
        localAmount: parseOptionalNumber(formValues.priceLocalAmount),
        cryptoAmount: parseOptionalNumber(formValues.priceCryptoAmount),
        regularLocalAmount: parseOptionalNumber(formValues.priceRegularLocalAmount),
        regularCryptoAmount: parseOptionalNumber(formValues.priceRegularCryptoAmount),
      },
      phonePlaceholder: formValues.phonePlaceholder,
      contact: {
        supportEmail: formValues.contactSupportEmail,
        supportPhone: formValues.contactSupportPhone,
        addressLine1: formValues.contactAddressLine1,
        addressLine2: formValues.contactAddressLine2,
        platformName: formValues.contactPlatformName,
      },
      payment: {
        lipaNambaNumber: formValues.paymentLipaNambaNumber,
        lipaNambaAccountName: formValues.paymentLipaNambaAccountName,
      },
    };

    const parsedSeatCapacity = parseOptionalNumber(formValues.seatCapacity);
    if (parsedSeatCapacity !== undefined) {
      payload.seatCapacity = parsedSeatCapacity;
    }

    for (const priceKey of Object.keys(payload.price)) {
      if (payload.price[priceKey] === undefined) {
        delete payload.price[priceKey];
      }
    }

    return payload;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);
    setIsSavingConfiguration(true);
    try {
      const responseBody = await adminUpdateEventConfiguration(
        buildOverridePayload(),
        adminToken
      );
      setLiveSeatCapacity(responseBody.liveSeatCapacity || null);
      setSuccessMessage(formatUpdateTimestamp(responseBody.updatedAt));
    } catch (error) {
      setFormError(error.message || 'Event configuration could not be saved.');
    } finally {
      setIsSavingConfiguration(false);
    }
  }

  if (isSessionRestoring) {
    return <AdminSessionLoading />;
  }

  if (!adminToken) {
    return null;
  }

  const canSave = formValues !== null;

  return (
    <>
      <section className="card">
        <div className="admin-toolbar">
          <div>
            <h2 className="card__title">Event settings</h2>
            <p className="muted">
              Signed in as {adminUser?.username || 'admin'} · changes apply to the live booking
              flow immediately
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
          <LoadingButton
            type="button"
            className="btn btn-primary"
            loadingLabel="Opening transactions…"
            onClick={() => router.push('/admin/transactions')}
          >
            View transactions
          </LoadingButton>
        </div>

        {isLoadingConfiguration ? (
          <RecordLoadingSkeleton
            statusLabel="Opening the event record…"
            sectionCount={3}
          />
        ) : (
          <>
            <div className="admin-detail-grid settings-readonly-strip">
              <div className="admin-detail-item">
                <strong>Slug</strong>
                {readOnlyDetails?.slug}
              </div>
              <div className="admin-detail-item">
                <strong>Local currency</strong>
                {readOnlyDetails?.localCurrency}
              </div>
              <div className="admin-detail-item">
                <strong>Crypto</strong>
                {readOnlyDetails?.cryptoCurrency} ({readOnlyDetails?.cryptoNetwork})
              </div>
              <div className="admin-detail-item">
                <strong>Duration</strong>
                {readOnlyDetails?.durationDays} days
              </div>
              <div className="admin-detail-item">
                <strong>Payment methods</strong>
                {readOnlyDetails?.paymentMethods?.join(', ')}
              </div>
              <div className="admin-detail-item">
                <strong>Coming soon</strong>
                {readOnlyDetails?.comingSoonPaymentMethods?.join(', ') || '—'}
              </div>
              <div className="admin-detail-item">
                <strong>Seats</strong>
                {liveSeatCapacity?.confirmedCount ?? 0} confirmed of{' '}
                {liveSeatCapacity?.cap ?? '—'} capacity
              </div>
            </div>

            {formError && <p className="error-banner">{formError}</p>}
            {successMessage && <p className="success-banner">{successMessage}</p>}

            {canSave && (
              <form className="settings-form" onSubmit={handleSubmit} autoComplete="off">
                <h3 className="settings-section-title">Event details</h3>
                <div className="admin-filter-row settings-field-row">
                  <label className="field settings-field-wide">
                    <span>Event name</span>
                    <input
                      type="text"
                      value={formValues.name}
                      onChange={(event) => updateFormField('name', event.target.value)}
                    />
                  </label>
                  <label className="field settings-field-wide">
                    <span>Tagline</span>
                    <input
                      type="text"
                      value={formValues.tagline}
                      onChange={(event) => updateFormField('tagline', event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Event date label</span>
                    <input
                      type="text"
                      value={formValues.eventDate}
                      onChange={(event) => updateFormField('eventDate', event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Location</span>
                    <input
                      type="text"
                      value={formValues.eventLocation}
                      onChange={(event) => updateFormField('eventLocation', event.target.value)}
                    />
                  </label>
                </div>

                <h3 className="settings-section-title">Prices</h3>
                <div className="admin-filter-row settings-field-row">
                  <label className="field">
                    <span>{readOnlyDetails?.localCurrency} price</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formValues.priceLocalAmount}
                      onChange={(event) =>
                        updateFormField('priceLocalAmount', event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{readOnlyDetails?.localCurrency} regular price</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formValues.priceRegularLocalAmount}
                      onChange={(event) =>
                        updateFormField('priceRegularLocalAmount', event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{readOnlyDetails?.cryptoCurrency} price</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formValues.priceCryptoAmount}
                      onChange={(event) =>
                        updateFormField('priceCryptoAmount', event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{readOnlyDetails?.cryptoCurrency} regular price</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formValues.priceRegularCryptoAmount}
                      onChange={(event) =>
                        updateFormField('priceRegularCryptoAmount', event.target.value)
                      }
                    />
                  </label>
                </div>

                <h3 className="settings-section-title">Lipa Namba</h3>
                <div className="admin-filter-row settings-field-row">
                  <label className="field">
                    <span>Lipa Namba number</span>
                    <input
                      type="text"
                      value={formValues.paymentLipaNambaNumber}
                      onChange={(event) =>
                        updateFormField('paymentLipaNambaNumber', event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Account name</span>
                    <input
                      type="text"
                      value={formValues.paymentLipaNambaAccountName}
                      onChange={(event) =>
                        updateFormField('paymentLipaNambaAccountName', event.target.value)
                      }
                    />
                  </label>
                </div>
                <p className="muted settings-hint">
                  These details are shown to attendees who choose Lipa Namba before they
                  upload their payment receipt.
                </p>

                <h3 className="settings-section-title">Capacity</h3>
                <div className="admin-filter-row settings-field-row">
                  <label className="field">
                    <span>Seat capacity</span>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={formValues.seatCapacity}
                      onChange={(event) =>
                        updateFormField('seatCapacity', event.target.value)
                      }
                    />
                  </label>
                </div>
                <p className="muted settings-hint">
                  {liveSeatCapacity
                    ? `${liveSeatCapacity.confirmedCount} seats are currently confirmed. The capacity cannot be set below that number.`
                    : 'The enforced seat limit updates as soon as this is saved.'}
                </p>

                <h3 className="settings-section-title">Booking form &amp; contact</h3>
                <div className="admin-filter-row settings-field-row">
                  <label className="field">
                    <span>Phone placeholder</span>
                    <input
                      type="text"
                      value={formValues.phonePlaceholder}
                      onChange={(event) =>
                        updateFormField('phonePlaceholder', event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Support email</span>
                    <input
                      type="email"
                      value={formValues.contactSupportEmail}
                      onChange={(event) =>
                        updateFormField('contactSupportEmail', event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Support phone</span>
                    <input
                      type="tel"
                      value={formValues.contactSupportPhone}
                      onChange={(event) =>
                        updateFormField('contactSupportPhone', event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Platform name</span>
                    <input
                      type="text"
                      value={formValues.contactPlatformName}
                      onChange={(event) =>
                        updateFormField('contactPlatformName', event.target.value)
                      }
                    />
                  </label>
                  <label className="field settings-field-wide">
                    <span>Address line 1</span>
                    <input
                      type="text"
                      value={formValues.contactAddressLine1}
                      onChange={(event) =>
                        updateFormField('contactAddressLine1', event.target.value)
                      }
                    />
                  </label>
                  <label className="field settings-field-wide">
                    <span>Address line 2</span>
                    <input
                      type="text"
                      value={formValues.contactAddressLine2}
                      onChange={(event) =>
                        updateFormField('contactAddressLine2', event.target.value)
                      }
                    />
                  </label>
                </div>

                <div className="admin-actions">
                  <LoadingButton
                    type="submit"
                    className="btn btn-primary"
                    spinnerColor="#f2ede3"
                    autoLoading={false}
                    loading={isSavingConfiguration}
                    loadingLabel="Saving settings…"
                  >
                    Save settings
                  </LoadingButton>
                </div>
              </form>
            )}
          </>
        )}
      </section>
    </>
  );
}