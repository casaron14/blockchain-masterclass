import Joi from 'joi';
import {
  registerReferrerInviteIdentity,
  fetchReferralSummaryReport,
} from '../services/referrerService.js';

const referrerRegistrationSchema = Joi.object({
  full_name: Joi.string().trim().min(2).max(120).required(),
  phone_number: Joi.string()
    .trim()
    .pattern(/^\+?[0-9]{9,15}$/)
    .required(),
});

async function registerReferrerInviteLink(req, res) {
  const { error: validationError, value: validatedReferrerDetails } =
    referrerRegistrationSchema.validate(req.body);

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

async function fetchReferralTrackingSummary(req, res) {
  try {
    const referralSummary = await fetchReferralSummaryReport();
    return res.status(200).json({ referrals: referralSummary });
  } catch (error) {
    console.error('Error fetching referral summary report', error);
    return res.status(500).json({ message: 'Server error while fetching referral report' });
  }
}

export default {
  registerReferrerInviteLink,
  fetchReferralTrackingSummary,
};