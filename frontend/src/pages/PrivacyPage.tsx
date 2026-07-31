import { useT } from '../i18n';

export function PrivacyPage() {
  const t = useT();
  return (
    <div className="px-3 py-4 sm:px-4 sm:max-w-2xl mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-4 text-[var(--text)]">{t('privacy.title')}</h1>
        <div className="text-sm space-y-3" style={{ color: 'var(--text2)' }}>
          <p>{t('privacy.intro')}</p>

          <h2 className="font-semibold text-base mt-4">{t('privacy.s1')}</h2>
          <p>{t('privacy.s1p1')}</p>
          <p>{t('privacy.s1p2')}</p>
          <p>{t('privacy.s1p3')}</p>
          <p>{t('privacy.s1p4')}</p>

          <h2 className="font-semibold text-base mt-4">{t('privacy.s2')}</h2>
          <p>{t('privacy.s2p1')}</p>
          <p>{t('privacy.s2p2')}</p>
          <p>{t('privacy.s2p3')}</p>

          <h2 className="font-semibold text-base mt-4">{t('privacy.s3')}</h2>
          <p>{t('privacy.s3p1')}</p>
          <p>{t('privacy.s3p2')}</p>

          <h2 className="font-semibold text-base mt-4">{t('privacy.s4')}</h2>
          <p>{t('privacy.s4p1')}</p>
          <p>{t('privacy.s4p2')}</p>

          <h2 className="font-semibold text-base mt-4">{t('privacy.s5')}</h2>
          <p>{t('privacy.s5p1')}</p>
          <p>{t('privacy.s5p2')}</p>

          <h2 className="font-semibold text-base mt-4">{t('privacy.s6')}</h2>
          <p>{t('privacy.s6p1')}</p>

          <p className="mt-4 text-sm" style={{ color: 'var(--text3)' }}>{t('privacy.updated')}</p>
        </div>
      </div>
    </div>
  );
}

