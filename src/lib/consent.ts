// src/lib/consent.ts
export type Consent = {
    necessary: true;        // altijd true
    analytics: boolean;
    marketing: boolean;
    updatedAt: number;
  };
  
  const KEY = 'cookie-consent:v1';
  
  export function getConsent(): Consent | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (typeof obj?.necessary !== 'boolean') return null;
      return {
        necessary: true,
        analytics: !!obj.analytics,
        marketing: !!obj.marketing,
        updatedAt: Number(obj.updatedAt || Date.now()),
      };
    } catch {
      return null;
    }
  }
  
  export function setConsent(next: Omit<Consent, 'updatedAt'>) {
    if (typeof window === 'undefined') return;
    const payload: Consent = { ...next, necessary: true, updatedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(payload));
    // Event zodat andere delen (bv. footer “Cookie settings”) de wijziging zien
    window.dispatchEvent(new CustomEvent('cookie-consent-changed', { detail: payload }));
  }
  
  export function openConsentSettings() {
    // simpele event om de UI te openen vanuit bv. de footer
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cookie-consent-open'));
    }
  }