import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

// iPad Safari reports layout viewport changes late; the app relies on
// 100dvh and safe-area insets, so no manual resize juggling is required.

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
