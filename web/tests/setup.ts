import '@testing-library/jest-dom/vitest';
import { beforeAll } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCommon from '../src/locales/en/common.json';
import esCommon from '../src/locales/es/common.json';

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: {
        en: { common: enCommon },
        es: { common: esCommon },
      },
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      interpolation: {
        escapeValue: false,
      },
    });
    return;
  }

  await i18n.changeLanguage('en');
});

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = () => {};
