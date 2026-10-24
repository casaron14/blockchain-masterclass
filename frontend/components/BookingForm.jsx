'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBookingRecord, createPaymentRecord } from '@/lib/api';
import {
  clearStoredBookingDraft,
  clearStoredBookingProgress,
  fetchStoredAttendeeProfile,
  fetchStoredBookingDraft,
  fetchStoredBookingRecord,
  fetchStoredPaymentId,
  storeAttendeeProfileLocally,
  storeBookingDraftLocally,
  storeBookingRecordLocally,
  storePaymentIdLocally,
} from '@/lib/bookingStorage';
import {
  clearStoredReferralSource,
  fetchStoredReferralSource,
} from '@/lib/referralStorage';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import LoadingButton from '@/components/LoadingButton';
import TurnstileWidget, { isTurnstileEnabled } from '@/components/TurnstileWidget';
import { buildPaymentPageUrlForPaymentId } from '@/lib/siteRoutes';
import {
  buildSanitizedAttendeePayload,
  sanitizeAttendeeFieldValue,
  validateBookingFormInput,
  validateSingleBookingFormField,
  FULL_NAME_MAX_LENGTH,
} from '@/lib/attendeeFormValidation';

export default function BookingForm() {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();
  const {
    slug,
    phonePlaceholder,
    paymentMethods,
    comingSoonPaymentMethods,
    cryptoCurrency,
    cryptoNetwork,
    seatHoldMinutes,
  } = eventConfig;
  const router = useRouter();

  const [attendeeDetails, setAttendeeDetails] = useState({
    full_name: '',
    phone_number: '',
    email: '',
  });
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const [activeBookingId, setActiveBookingId] = useState(null);
  const [activePaymentId, setActivePaymentId] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState(null);
  const [turnstileChallengeFailed, setTurnstileChallengeFailed] = useState(false);
  const turnstileWidgetRef = useRef(null);

  useEffect(() => {
    const storedBookingDraft = fetchStoredBookingDraft(slug);
    if (storedBookingDraft) {
      setAttendeeDetails({
        full_name: sanitizeAttendeeFieldValue('full_name', storedBookingDraft.full_name),
        phone_number: sanitizeAttendeeFieldValue(
          'phone_number',
          storedBookingDraft.phone_number
        ),
        email: sanitizeAttendeeFieldValue('email', storedBookingDraft.email),
      });
      setSelectedPaymentMethod(
        paymentMethods.some(
          (paymentMethodOption) => paymentMethodOption.key === storedBookingDraft.payment_method
        )
          ? storedBookingDraft.payment_method
          : null
      );
      return;
    }

    const storedAttendeeProfile = fetchStoredAttendeeProfile();
    if (storedAttendeeProfile) {
      setAttendeeDetails({
        full_name: sanitizeAttendeeFieldValue('full_name', storedAttendeeProfile.full_name),
        phone_number: sanitizeAttendeeFieldValue(
          'phone_number',
          storedAttendeeProfile.phone_number
        ),
        email: sanitizeAttendeeFieldValue('email', storedAttendeeProfile.email),
      });
    }
  }, [slug]);

  useEffect(() => {
    const storedBooking = fetchStoredBookingRecord(slug);
    const storedPaymentId = fetchStoredPaymentId(slug);
    if (!storedBooking || !storedPaymentId) {
      return;
    }
    const storedBookingExpiresAt = storedBooking.expires_at
      ? Date.parse(storedBooking.expires_at)
      : null;
    if (storedBookingExpiresAt && storedBookingExpiresAt <= Date.now()) {
      clearStoredBookingProgress(slug);
      return;
    }
    setActiveBookingId(storedBooking.id);
    setActivePaymentId(storedPaymentId);
  }, [slug]);

  function persistAttendeeDraft(nextAttendeeDetails, nextPaymentMethod) {
    const savedDraft = {
      full_name: nextAttendeeDetails.full_name,
      phone_number: nextAttendeeDetails.phone_number,
      email: nextAttendeeDetails.email,
      payment_method: nextPaymentMethod,
    };
    if (Object.values(savedDraft).every((value) => value === '' || value === null)) {
      clearStoredBookingDraft(slug);
    } else {
      storeBookingDraftLocally(slug, savedDraft);
    }

    const nextAttendeeProfile = {
      full_name: nextAttendeeDetails.full_name,
      phone_number: nextAttendeeDetails.phone_number,
      email: nextAttendeeDetails.email,
    };
    if (
      Object.values(nextAttendeeProfile).some(
        (profileValue) => profileValue !== '' && profileValue !== null
      )
    ) {
      storeAttendeeProfileLocally(nextAttendeeProfile);
    }
  }

  function updateField(fieldName, fieldValue) {
    const sanitizedFieldValue = sanitizeAttendeeFieldValue(fieldName, fieldValue);
    const nextAttendeeDetails = {
      ...attendeeDetails,
      [fieldName]: sanitizedFieldValue,
    };
    setAttendeeDetails(nextAttendeeDetails);
    persistAttendeeDraft(nextAttendeeDetails, selectedPaymentMethod);

    if (validationErrors[fieldName]) {
      const nextValidationErrors = { ...validationErrors };
      delete nextValidationErrors[fieldName];
      setValidationErrors(nextValidationErrors);
    }
  }

  function handleFieldBlur(fieldName, fieldValue) {
    const fieldErrors = validateSingleBookingFormField(
      fieldName,
      fieldValue,
      t
    );
    const nextValidationErrors = { ...validationErrors, ...fieldErrors };
    if (Object.keys(fieldErrors).length === 0) {
      delete nextValidationErrors[fieldName];
    }
    setValidationErrors(nextValidationErrors);
  }

  function updatePaymentMethod(methodKey) {
    setSelectedPaymentMethod(methodKey);
    persistAttendeeDraft(attendeeDetails, methodKey);
    if (validationErrors.payment_method) {
      const nextValidationErrors = { ...validationErrors };
      delete nextValidationErrors.payment_method;
      setValidationErrors(nextValidationErrors);
    }
  }

  function validateForm() {
    return validateBookingFormInput(
      attendeeDetails,
      selectedPaymentMethod,
      t
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError(null);

    const errors = validateForm();
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (isTurnstileEnabled() && !turnstileToken) {
      setSubmitError(t('booking.errors.turnstileRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const referralUtmSource = fetchStoredReferralSource(slug);
      const sanitizedAttendeePayload = buildSanitizedAttendeePayload(attendeeDetails);
      const createdBookingResult = await createBookingRecord(
        {
          ...sanitizedAttendeePayload,
          ...(referralUtmSource ? { utm_source: referralUtmSource } : {}),
        },
        slug,
        turnstileToken
      );
      const createdBooking = createdBookingResult.booking;

      storeBookingRecordLocally(slug, createdBooking);
      clearStoredReferralSource(slug);

      const createdPaymentResult = await createPaymentRecord({
        bookingId: createdBooking.id,
        paymentMethod: selectedPaymentMethod,
      });

      storePaymentIdLocally(slug, createdPaymentResult.payment.id);
      clearStoredBookingDraft(slug);
      storeAttendeeProfileLocally(sanitizedAttendeePayload);

      router.push(buildPaymentPageUrlForPaymentId(createdPaymentResult.payment.id));
    } catch (error) {
      if (isTurnstileEnabled()) {
        turnstileWidgetRef.current?.resetChallengeWidget();
        setTurnstileToken(null);
      }

      const errorCode = error.responseBody?.error;
      if (errorCode === 'TURNSTILE_TOKEN_REQUIRED') {
        setSubmitError(t('booking.errors.turnstileRequired'));
      } else if (errorCode === 'TURNSTILE_VERIFICATION_FAILED') {
        setSubmitError(t('booking.errors.turnstileFailed'));
      } else if (errorCode === 'TURNSTILE_VERIFICATION_UNAVAILABLE') {
        setSubmitError(t('booking.errors.turnstileUnavailable'));
      } else if (error.responseBody?.error) {
        setSubmitError(error.responseBody.error);
      } else {
        setSubmitError(t('booking.errors.generic'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDiscardActiveBooking() {
    clearStoredBookingProgress(slug);
    setActiveBookingId(null);
    setActivePaymentId(null);
  }

  const hasActiveBooking = activeBookingId && activePaymentId;

  return (
    <>
      {hasActiveBooking && (
        <section className="notice-panel">
          <h2 className="notice-panel__title">{t('booking.resumeTitle')}</h2>
          <p className="notice-panel__note">{t('booking.resumeNote', { minutes: seatHoldMinutes })}</p>
          <div className="notice-panel__actions">
            <LoadingButton
              type="button"
              className="btn btn-primary"
              spinnerColor="#f2ede3"
              onClick={() => router.push(buildPaymentPageUrlForPaymentId(activePaymentId))}
            >
              {t('booking.resumePayment')}
            </LoadingButton>
            <LoadingButton
              type="button"
              className="btn btn-secondary"
              onClick={handleDiscardActiveBooking}
            >
              {t('booking.startOver')}
            </LoadingButton>
          </div>
        </section>
      )}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>{t('booking.fullName')}</span>
          <input
            type="text"
            value={attendeeDetails.full_name}
            onChange={(e) => updateField('full_name', e.target.value)}
            onBlur={(e) => handleFieldBlur('full_name', e.target.value)}
            autoComplete="name"
            maxLength={FULL_NAME_MAX_LENGTH}
            aria-invalid={Boolean(validationErrors.full_name)}
            aria-describedby="fullNameFieldError"
          />
          {validationErrors.full_name && (
            <span className="field-error" id="fullNameFieldError" role="alert">
              {validationErrors.full_name}
            </span>
          )}
        </label>

        <label className="field">
          <span>{t('booking.email')}</span>
          <input
            type="email"
            value={attendeeDetails.email}
            onChange={(e) => updateField('email', e.target.value)}
            onBlur={(e) => handleFieldBlur('email', e.target.value)}
            autoComplete="email"
            maxLength="254"
            aria-invalid={Boolean(validationErrors.email)}
            aria-describedby="emailFieldError"
          />
          {validationErrors.email && (
            <span className="field-error" id="emailFieldError" role="alert">
              {validationErrors.email}
            </span>
          )}
        </label>

        <label className="field">
          <span>{t('booking.phoneNumber')}</span>
          <input
            type="tel"
            inputMode="tel"
            value={attendeeDetails.phone_number}
            onChange={(e) => updateField('phone_number', e.target.value)}
            onBlur={(e) => handleFieldBlur('phone_number', e.target.value)}
            placeholder={phonePlaceholder}
            autoComplete="tel"
            maxLength="16"
            aria-invalid={Boolean(validationErrors.phone_number)}
            aria-describedby="phoneNumberFieldError"
          />
          {validationErrors.phone_number && (
            <span className="field-error" id="phoneNumberFieldError" role="alert">
              {validationErrors.phone_number}
            </span>
          )}
        </label>

        <div className="method-list" role="radiogroup" aria-label={t('booking.paymentMethod')}>
          {paymentMethods.map((paymentMethodOption) => {
            const methodKey = paymentMethodOption.key;
            const isSelected = selectedPaymentMethod === methodKey;
            const label = t(paymentMethodOption.labelKey, {
              crypto: cryptoCurrency,
              network: cryptoNetwork,
            });

            return (
              <label
                key={methodKey}
                className={`method-card ${isSelected ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  value={methodKey}
                  checked={isSelected}
                  onChange={() => updatePaymentMethod(methodKey)}
                />
                <span>
                  <strong>{label}</strong>
                </span>
              </label>
            );
          })}
          {comingSoonPaymentMethods.map((paymentMethodOption) => (
            <label
              key={paymentMethodOption.key}
              className="method-card method-card--coming-soon"
              aria-disabled="true"
            >
              <input
                type="radio"
                name="payment-method"
                value={paymentMethodOption.key}
                disabled
              />
              <span>
                <strong>
                  {t(paymentMethodOption.labelKey, {
                    crypto: cryptoCurrency,
                    network: cryptoNetwork,
                  })}
                </strong>
                <span className="method-card__badge">{t('payment.comingSoon')}</span>
              </span>
            </label>
          ))}
          {validationErrors.payment_method && (
            <span className="field-error" id="paymentMethodFieldError" role="alert">
              {validationErrors.payment_method}
            </span>
          )}
        </div>

        <p className="muted">{t('booking.holdNote', { holdMinutes: seatHoldMinutes })}</p>

        <TurnstileWidget
          ref={turnstileWidgetRef}
          loadingLabel={t('loadingStates.securityCheck')}
          onTokenGenerated={setTurnstileToken}
          onTokenExpired={() => setTurnstileToken(null)}
          onChallengeError={() => setTurnstileChallengeFailed(true)}
        />
        {turnstileChallengeFailed && (
          <p className="error-banner">{t('booking.errors.turnstileUnavailable')}</p>
        )}

        {submitError && <p className="error-banner">{submitError}</p>}

        <LoadingButton
          type="submit"
          className="btn btn-primary form__submit"
          spinnerColor="#f2ede3"
          autoLoading={false}
          loading={isSubmitting}
          loadingLabel={t('loadingStates.creatingBooking')}
        >
          {t('booking.submit')}
        </LoadingButton>
      </form>
    </>
  );
}