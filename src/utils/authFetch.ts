import { auth } from '../firebase';

export const AUTH_REQUIRED_EVENT = 'ovozstudio:auth-required';

export function triggerAuthModal(reason?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AUTH_REQUIRED_EVENT, {
        detail: { reason },
      })
    );
  }
}

export interface AuthFetchOptions extends RequestInit {
  skipAuth?: boolean;
}

/**
 * Authorized fetch wrapper for OvozStudio.AI
 * Automatically acquires fresh Firebase ID Token and injects Authorization: Bearer <token>
 * If unauthenticated on a protected endpoint, prompts the login modal and halts the request.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: AuthFetchOptions
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const isApi = url.startsWith('/api/');
  const isPublicApi = url === '/api/health' || url === '/api/billing/config';

  const options: AuthFetchOptions = { ...(init || {}) };
  const headers = new Headers(options.headers || {});

  if (isApi && !isPublicApi && !options.skipAuth) {
    const user = auth.currentUser;
    if (!user) {
      triggerAuthModal("Iltimos, ushbu funksiyadan foydalanish uchun tizimga kiring.");
      throw new Error('unauthorized: login required');
    }

    try {
      const idToken = await user.getIdToken();
      headers.set('Authorization', `Bearer ${idToken}`);
    } catch (err) {
      console.error('Failed to obtain Firebase ID token:', err);
      triggerAuthModal("Sessiyani tasdiqlashda xatolik. Qaytadan kiring.");
      throw new Error('unauthorized: token acquisition failed');
    }
  }

  options.headers = headers;
  const response = await fetch(input, options);

  // If server returns 401 unauthorized, open auth modal
  if (response.status === 401 && isApi && !isPublicApi) {
    triggerAuthModal("Sessiya muddati tugagan. Iltimos, tizimga qayta kiring.");
  }

  // If server returns 402 payment required, trigger pricing modal
  if (response.status === 402 && isApi) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ovozstudio:open-pricing'));
    }
  }

  return response;
}

/**
 * Returns the current Firebase ID Token, or null if unauthenticated.
 * Used for authenticated WebSocket connections like /api/live-call?token=<token>
 */
export async function getCurrentIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (err) {
    console.error('Error fetching ID token:', err);
    return null;
  }
}
