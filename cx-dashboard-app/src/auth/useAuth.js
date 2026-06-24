import { useCallback } from 'react';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { tokenRequest } from './msalConfig';
import { acquireToken } from './AuthProvider';

export default function useAuth() {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  const login = useCallback(() => instance.loginRedirect(tokenRequest), [instance]);
  const logout = useCallback(
    () => instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin }),
    [instance]
  );
  const getToken = useCallback(() => acquireToken(), []);

  const account = accounts[0] || null;
  return {
    user: account ? { name: account.name, username: account.username } : null,
    isAuthenticated,
    isLoading: inProgress !== 'none',
    login,
    logout,
    getToken,
  };
}
