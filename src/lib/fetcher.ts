export async function fetchJSON(
    url: string,
    opts: RequestInit = {},
    { retries = 2, timeoutMs = 8000 } = {}
  ) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        clearTimeout(t);
        if (attempt === retries) throw e;
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }