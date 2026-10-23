function readAllowedWebhookIpAddressesFromEnvironment() {
  const configuredIpAddresses = process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS;
  if (!configuredIpAddresses) {
    return null;
  }
  return new Set(
    configuredIpAddresses
      .split(',')
      .map((ipAddress) => ipAddress.trim())
      .filter((ipAddress) => ipAddress.length > 0)
  );
}

export function requireAzamPayWebhookSourceIpAllowlist(req, res, next) {
  const allowedIpAddresses = readAllowedWebhookIpAddressesFromEnvironment();

  if (!allowedIpAddresses) {
    return next();
  }

  const requestIpAddress = req.ip;
  if (!requestIpAddress) {
    return res.status(403).json({ message: 'Webhook request source could not be identified' });
  }

  if (allowedIpAddresses.has(requestIpAddress)) {
    return next();
  }

  return res.status(403).json({ message: 'Webhook request source is not allowed' });
}

export default requireAzamPayWebhookSourceIpAllowlist;