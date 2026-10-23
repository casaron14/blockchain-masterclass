'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import LoadingButton from '@/components/LoadingButton';

export default function NewsletterSignup() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  async function handleSubscribe(event) {
    event.preventDefault();
    if (!email.trim() || !consent) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setSubscribed(true);
  }

  if (subscribed) {
    return <p role="status">{t('site.footer.thanks')}</p>;
  }

  return (
    <form className="newsletter-form" onSubmit={handleSubscribe}>
      <div>
        <label htmlFor="newsletter-email" className="newsletter-label">
          {t('site.footer.emailLabel')}
        </label>
        <input
          id="newsletter-email"
          className="newsletter-input"
          type="email"
          required
          placeholder={t('site.footer.subscribePlaceholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <label className="newsletter-consent" htmlFor="newsletter-consent">
        <input
          id="newsletter-consent"
          type="checkbox"
          required
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>{t('site.footer.subscribeCheckbox')}</span>
      </label>
      <LoadingButton
        type="submit"
        className="newsletter-button"
        spinnerColor="#14120e"
        loadingLabel={t('loadingStates.subscribing')}
      >
        {t('site.footer.subscribe')}
      </LoadingButton>
    </form>
  );
}