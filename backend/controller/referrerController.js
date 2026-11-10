import Joi from 'joi';

import {
  registerReferrerInviteIdentity,
  fetchReferralSummaryReport,
  fetchReferrerByUsername,
  fetchReferredClientsForReferralCode,
} from '../services/referrerService.js';

import {
  buildCsvExportFileName,
  buildReferralSummaryCsvDocument,
  buildReferredClientsCsvDocument,
} from '../services/adminCsvExportService.js';

import { sendCsvFileDownloadResponse } from '../utils/csvDownloadResponse.js';

const referrerRegistrationSchema = Joi.object({
  full_name: Joi.string().trim().min(2).max(120).required(),
  phone_number: Joi.string()
    .trim()
    .pattern(/^\+?[0-9]{9,15}$/)
    .required(),
});

const REFERRAL_CODE_PATTERN = /^[a-zA-Z0-9_.-]{2,100}$/;

function readValidatedReferralCode(rawReferralCode) {
  const referralCode = String(rawReferralCode || '').trim();
  if (!REFERRAL_CODE_PATTERN.test(referralCode)) {
    return null;
  }
  return referralCode;
}

function validateReferrerRegistrationBody(requestBody) {
  return referrerRegistrationSchema.validate(requestBody ?? {});
}

async function registerReferrerInviteLink(req, res) {
  const { error: validationError, value: validatedReferrerDetails } =
    validateReferrerRegistrationBody(req.body);

  if (validationError) {
    return res
      .status(400)
      .json({ message: 'Validation failed', error: validationError.details[0].message });
  }

  try {
    const referrerRecord = await registerReferrerInviteIdentity(
      validatedReferrerDetails.full_name,
      validatedReferrerDetails.phone_number
    );
    return res.status(201).json({ referrer: referrerRecord });
  } catch (error) {
    console.error('Error registering referrer invite identity', error);
    return res.status(500).json({ message: 'Server error while creating your invite link' });
  }
}

async function createReferrerInviteRecordEndpoint(req, res) {
  const { error: validationError, value: validatedReferrerDetails } =
    validateReferrerRegistrationBody(req.body);

  if (validationError) {
    return res
      .status(400)
      .json({ message: 'Validation failed', error: validationError.details[0].message });
  }

  try {
    const referrerRecord = await registerReferrerInviteIdentity(
      validatedReferrerDetails.full_name,
      validatedReferrerDetails.phone_number
    );
    return res.status(201).json({ referrer: referrerRecord });
  } catch (error) {
    console.error('Error creating referrer invite record from admin', error);
    return res.status(500).json({ message: 'Server error while creating the referral link' });
  }
}

async function fetchReferralTrackingSummary(req, res) {
  try {
    const referralSummary = await fetchReferralSummaryReport();
    return res.status(200).json({ referrals: referralSummary });
  } catch (error) {
    console.error('Error fetching referral summary report', error);
    return res.status(500).json({ message: 'Server error while fetching referral report' });
  }
}

async function fetchReferredClientsEndpoint(req, res) {
  const referralCode = readValidatedReferralCode(req.params.referrerCode);

  if (!referralCode) {
    return res.status(400).json({ message: 'Invalid referral code' });
  }

  try {
    const referrerRecord = await fetchReferrerByUsername(referralCode);
    const referredClientRows = await fetchReferredClientsForReferralCode(referralCode);

    if (!referrerRecord && referredClientRows.length === 0) {
      return res.status(404).json({ message: 'Referral code not found' });
    }

    return res.status(200).json({
      referralCode,
      referrer: referrerRecord,
      clients: referredClientRows,
    });
  } catch (error) {
    console.error('Error fetching referred clients', error);
    return res.status(500).json({ message: 'Server error while fetching referred clients' });
  }
}

async function exportReferredClientsAsCsvEndpoint(req, res) {
  const referralCode = readValidatedReferralCode(req.params.referrerCode);

  if (!referralCode) {
    return res.status(400).json({ message: 'Invalid referral code' });
  }

  try {
    const referrerRecord = await fetchReferrerByUsername(referralCode);
    const referredClientRows = await fetchReferredClientsForReferralCode(referralCode);

    if (!referrerRecord && referredClientRows.length === 0) {
      return res.status(404).json({ message: 'Referral code not found' });
    }

    const csvDownloadFileName = buildCsvExportFileName(
      `referred-clients-${referralCode}`
    );

    return sendCsvFileDownloadResponse(
      res,
      buildReferredClientsCsvDocument(referredClientRows),
      csvDownloadFileName
    );
  } catch (error) {
    console.error('Error exporting referred clients as CSV', error);
    return res.status(500).json({ message: 'Server error while exporting referred clients' });
  }
}

async function exportReferralSummaryAsCsvEndpoint(req, res) {
  try {
    const referralSummaryRows = await fetchReferralSummaryReport();

    return sendCsvFileDownloadResponse(
      res,
      buildReferralSummaryCsvDocument(referralSummaryRows),
      buildCsvExportFileName('referral-summary')
    );
  } catch (error) {
    console.error('Error exporting referral summary as CSV', error);
    return res.status(500).json({ message: 'Server error while exporting referrals' });
  }
}

export default {
  registerReferrerInviteLink,
  createReferrerInviteRecordEndpoint,
  fetchReferralTrackingSummary,
  fetchReferredClientsEndpoint,
  exportReferredClientsAsCsvEndpoint,
  exportReferralSummaryAsCsvEndpoint,
};
