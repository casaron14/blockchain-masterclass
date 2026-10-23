'use client';

import { SUPPORTED_LANGUAGES } from '@/lib/translations';
import { useLanguage } from '@/context/LanguageContext';

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="language-switcher" role="group" aria-label="Language">
      {Object.entries(SUPPORTED_LANGUAGES).map(([code, label]) => (
        <button
          key={code}
          type="button"
          className={code === language ? 'language-button active' : 'language-button'}
          aria-pressed={code === language}
          onClick={() => setLanguage(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}