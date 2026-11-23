'use client';

import Image from 'next/image';
import sessionPhotographOne from '@/assets/IMG_5762.webp';
import sessionPhotographTwo from '@/assets/WhatsApp Image 2026-11-23 at 15.02.52.webp';
import sessionPhotographThree from '@/assets/WhatsApp Image 2026-11-23 at 15.02.55.webp';
import sessionPhotographFour from '@/assets/WhatsApp Image 2026-11-23 at 15.02.55 (1).webp';
import sessionPhotographFive from '@/assets/WhatsApp Image 2026-11-23 at 15.08.58.webp';
import sessionPhotographSix from '@/assets/WhatsApp Image 2026-11-23 at 15.08.58 (1).webp';
import { useLanguage } from '@/context/LanguageContext';

const sessionPhotographSources = [
  sessionPhotographOne,
  sessionPhotographTwo,
  sessionPhotographThree,
  sessionPhotographFour,
  sessionPhotographFive,
  sessionPhotographSix,
];

export default function SessionGalleryMarquee() {
  const { t } = useLanguage();

  const renderSessionPhotographFrames = (isDuplicateGroup) =>
    sessionPhotographSources.map((sessionPhotographSource, sessionPhotographIndex) => (
      <div
        className="session-gallery__frame"
        key={`${isDuplicateGroup ? 'copy' : 'original'}-${sessionPhotographIndex}`}
      >
        <Image
          src={sessionPhotographSource}
          alt={
            isDuplicateGroup
              ? ''
              : t('site.gallery.photographAlt', { index: sessionPhotographIndex + 1 })
          }
          fill
          sizes="(max-width: 48rem) 70vw, 22rem"
        />
      </div>
    ));

  return (
    <section className="session-gallery" aria-label={t('site.gallery.label')}>
      <div className="session-gallery__viewport">
        <div className="session-gallery__track">
          <div className="session-gallery__group">
            {renderSessionPhotographFrames(false)}
          </div>
          <div className="session-gallery__group session-gallery__group--duplicate" aria-hidden="true">
            {renderSessionPhotographFrames(true)}
          </div>
        </div>
      </div>
    </section>
  );
}
