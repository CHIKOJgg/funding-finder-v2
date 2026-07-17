import { useT } from '../i18n';

export function TermsPage() {
  const t = useT();
  return (
    <div className="px-3 py-4 sm:px-4 sm:max-w-2xl mx-auto">
      <div className="card">
        <h1 className="text-xl font-bold mb-4 text-[var(--text)]">{t('terms.title')}</h1>
        <div className="text-sm text-gray-700 space-y-3">
          <p>{t('terms.intro')}</p>

          <h2 className="font-semibold text-base mt-4">{t('terms.s1')}</h2>
          <p>{t('terms.s1p1')}</p>
          <p>{t('terms.s1p2')}</p>

          <h2 className="font-semibold text-base mt-4">{t('terms.s2')}</h2>
          <p>{t('terms.s2p1')}</p>
          <p>{t('terms.s2p2')}</p>

          <h2 className="font-semibold text-base mt-4">{t('terms.s3')}</h2>
          <p>{t('terms.s3p1')}</p>
          <p>{t('terms.s3p2')}</p>

          <h2 className="font-semibold text-base mt-4">{t('terms.s4')}</h2>
          <p>{t('terms.s4p1')}</p>
          <p>{t('terms.s4p2')}</p>

          <h2 className="font-semibold text-base mt-4">{t('terms.s5')}</h2>
          <p>{t('terms.s5p1')}</p>
          <p>{t('terms.s5p2')}</p>

          <h2 className="font-semibold text-base mt-4">{t('terms.s6')}</h2>
          <p>{t('terms.s6p1')}</p>
          <p>{t('terms.s6p2')}</p>

          <h2 className="font-semibold text-base mt-4">{t('terms.s7')}</h2>
          <p>{t('terms.s7p1')}</p>

          <p className="mt-4 text-gray-500">{t('terms.updated')}</p>
        </div>
      </div>
    </div>
  );
}

