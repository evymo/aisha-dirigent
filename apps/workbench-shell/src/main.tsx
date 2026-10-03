import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { getLocale, t } from './i18n.js';
import '@aisha/design-language/styles.css';
import '@aisha/extranet-sdk-ui/styles.css'; // pulls adapter.css itself (token translation)
import './styles.css';

document.title = t('app.title');
document.documentElement.lang = getLocale();

// Workbench is a live-only operator surface — NO service worker / offline cache
// (it renders confidential registry data that must never persist on the device).

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
