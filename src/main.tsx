import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startSync } from './store/sync';
import App from './ui/App';
import './styles.css';

void startSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
