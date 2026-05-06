const BASE = 'https://rxnav.nlm.nih.gov/REST';

/** @type {Map<string, Array<{url:string,name:string,shape:string,color:string,imprint:string}>>} */
const imageCache = new Map();

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
 * Fetch pill images for an RxCUI from the NLM RxImage database.
 *
 * @param {string} rxcui
 * @returns {Promise<Array<{url: string, name: string, shape: string, color: string, imprint: string}>>}
 */
export async function getMedImages(rxcui) {
  if (imageCache.has(rxcui)) return imageCache.get(rxcui);
  try {
    const url = `https://rximage.nlm.nih.gov/api/rximage/1/rxbase?rxcui=${encodeURIComponent(rxcui)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = await res.json();
    const images = body?.nlmRxImages;
    if (!Array.isArray(images) || !images.length) return [];
    const result = images.slice(0, 6).map((img) => ({
      url:     String(img.imageUrl ?? ''),
      name:    String(img.name ?? ''),
      shape:   String(img.shapeText ?? ''),
      color:   String(img.colorText ?? ''),
      imprint: String(img.imprint ?? ''),
    }));
    imageCache.set(rxcui, result);
    return result;
  } catch (err) {
    console.error('[rxnorm] getMedImages error:', err.message);
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
