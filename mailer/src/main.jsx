// エントリポイント — ErrorBoundary > ToastProvider > App
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary, ToastProvider } from './common.jsx';
import { App } from './App.jsx';

const root = createRoot(document.getElementById('root'));
root.render(
  <ErrorBoundary>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ErrorBoundary>,
);
