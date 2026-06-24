/**
 * Design preview entry (preview.html) — renders the full app with mocked
 * API data and a logged-out MSAL context. For styling work only; the
 * production bundle (index.html) never includes this file.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import client from '../api/client';
import { matchFixture } from './fixtures';
import App from '../App';
import '../index.css';

// Serve every API call from fixtures with a small delay so skeletons show
client.defaults.adapter = async (config) => {
  await new Promise((r) => setTimeout(r, 350));
  const data = matchFixture(`${config.url}`);
  if (data == null) {
    return { status: 404, statusText: 'Not Found', data: { error: `no fixture for ${config.url}` }, headers: {}, config };
  }
  return { status: 200, statusText: 'OK', data, headers: {}, config };
};

const pca = new PublicClientApplication({
  auth: { clientId: '00000000-0000-0000-0000-000000000000' },
  cache: { cacheLocation: 'sessionStorage' },
});

pca.initialize().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <MsalProvider instance={pca}>
        <App />
      </MsalProvider>
    </React.StrictMode>
  );
});
