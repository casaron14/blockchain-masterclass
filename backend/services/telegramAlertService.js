export function resolveTelegramConfiguration() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return null;
  }
  return { botToken, chatId };
}

export function buildTelegramSendMessageUrl(botToken) {
  return `https://api.telegram.org/bot${botToken}/sendMessage`;
}

export async function sendTelegramAlertMessage(alertMessage, fetchImpl = fetch) {
  const telegramConfiguration = resolveTelegramConfiguration();
  if (!telegramConfiguration) {
    return { sent: false, reason: 'TELEGRAM_NOT_CONFIGURED' };
  }

  const telegramSendUrl = buildTelegramSendMessageUrl(telegramConfiguration.botToken);

  const response = await fetchImpl(telegramSendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramConfiguration.chatId,
      text: alertMessage,
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Telegram alert failed (${response.status}): ${responseBody}`);
  }

  return { sent: true };
}