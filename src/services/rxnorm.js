const BASE = 'https://rxnav.nlm.nih.gov/REST';

/**
 * Search RxNorm for medications matching the query string.
 *
 * @param {string} q
 * @returns {Promise<Array<{rxcui: string, name: string}>>}
 */
export async function searchMeds(q) {
  try {
    const url = `${BASE}/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=8`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = await res.json();
    const candidates = body?.approximateGroup?.candidate;
    if (!Array.isArray(candidates)) return [];
    const seen = new Set();
    return candidates
      .filter((c) => c.name && !seen.has(c.rxcui) && seen.add(c.rxcui))
      .map((c) => ({ rxcui: String(c.rxcui), name: String(c.name) }));
  } catch (err) {
    console.error('[rxnorm] searchMeds error:', err.message);
    return [];
  }
}

/**
 * Fetch detailed properties for a single RxCUI.
 *
 * @param {string} rxcui
 * @returns {Promise<{rxcui: string, name: string, strength: string, form: string} | null>}
 */
export async function getMedDetails(rxcui) {
  try {
    const url = `${BASE}/rxcui/${encodeURIComponent(rxcui)}/properties.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json();
    const p = body?.properties;
    if (!p) return null;
    return {
      rxcui: String(p.rxcui ?? rxcui),
      name: String(p.name ?? ''),
      strength: String(p.strength ?? ''),
      form: String(p.doseFormGroupName ?? ''),
    };
  } catch (err) {
    console.error('[rxnorm] getMedDetails error:', err.message);
    return null;
  }
}
