/**
 * Medication detail page — pill photo management.
 * Handles camera/gallery upload and API image browser.
 */

const gallery   = document.getElementById('med-images');
const medId     = gallery?.dataset.medId;
const imageList = document.getElementById('med-image-list');
const emptyMsg  = document.getElementById('med-image-empty');

if (!medId) throw new Error('med-images element missing');

/* ─── Camera / gallery upload ─────────────────────────────── */

document.getElementById('camera-input')?.addEventListener('change', async (e) => {
  const file = /** @type {HTMLInputElement} */ (e.currentTarget).files?.[0];
  if (!file) return;

  const fd = new FormData();
  fd.append('photo', file);
  /** @type {HTMLInputElement} */ (e.currentTarget).value = '';

  try {
    const res = await fetch(`/api/medications/${medId}/images/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Upload failed');
    appendImageItem(await res.json());
  } catch {
    // silently fail — user can retry by selecting again
  }
});

/* ─── Delete image ────────────────────────────────────────── */

imageList?.addEventListener('click', async (e) => {
  const btn = /** @type {Element} */ (e.target).closest('[data-delete-image]');
  if (!btn) return;

  const imageId = /** @type {HTMLElement} */ (btn).dataset.deleteImage;
  const li      = btn.closest('.med-image-item');

  /** @type {HTMLButtonElement} */ (btn).disabled = true;

  try {
    const res = await fetch(`/api/medications/${medId}/images/${imageId}/delete`, { method: 'POST' });
    if (!res.ok) throw new Error('Delete failed');
    li?.remove();
    if (!imageList.children.length && emptyMsg) emptyMsg.hidden = false;
  } catch {
    /** @type {HTMLButtonElement} */ (btn).disabled = false;
  }
});

/* ─── API images browser ──────────────────────────────────── */

const modal      = /** @type {HTMLDialogElement|null} */ (document.getElementById('api-images-modal'));
const browseBtn  = document.getElementById('browse-api-images-btn');
const closeBtn   = document.getElementById('close-api-images');
const apiList    = document.getElementById('api-images-list');
const apiStatus  = document.getElementById('api-images-status');

/** @type {Map<string, Array<{url:string,name:string,shape:string,color:string,imprint:string}>>} */
const apiCache = new Map();

browseBtn?.addEventListener('click', () => {
  modal?.showModal();
  loadApiImages();
});

closeBtn?.addEventListener('click', () => modal?.close());
modal?.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

async function loadApiImages() {
  const rxcui = browseBtn?.dataset.rxcui;
  if (!rxcui || !apiList || !apiStatus) return;

  apiList.innerHTML     = '';
  apiStatus.textContent = 'Loading pill photos…';

  try {
    const images = apiCache.has(rxcui)
      ? apiCache.get(rxcui)
      : await fetch(`/api/meds/images/${encodeURIComponent(rxcui)}`).then((r) => r.json());

    if (!apiCache.has(rxcui)) apiCache.set(rxcui, images);

    if (!Array.isArray(images) || !images.length) {
      apiStatus.textContent = 'No pill photos available for this medication.';
      return;
    }

    apiStatus.textContent = '';

    for (const img of images) {
      const li = document.createElement('li');
      li.className = 'api-image-item';

      const photo = document.createElement('img');
      photo.src       = img.url;
      photo.alt       = [img.shape, img.color, img.imprint].filter(Boolean).join(', ') || 'Pill photo';
      photo.className = 'api-image-photo';
      photo.loading   = 'lazy';

      const caption = document.createElement('p');
      caption.className   = 'api-image-caption';
      const parts = [];
      if (img.shape)   parts.push(img.shape);
      if (img.color)   parts.push(img.color);
      if (img.imprint) parts.push(`"${img.imprint}"`);
      caption.textContent = parts.join(' · ') || img.name || '';

      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'btn btn--primary btn--sm api-image-select-btn';
      btn.textContent = 'Save photo';
      btn.addEventListener('click', () => selectApiImage(img.url, btn));

      li.append(photo, caption, btn);
      apiList.append(li);
    }
  } catch {
    apiStatus.textContent = 'Could not load pill photos. Please try again.';
  }
}

/**
 * @param {string} url
 * @param {HTMLButtonElement} btn
 */
async function selectApiImage(url, btn) {
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    const res = await fetch(`/api/medications/${medId}/images/select`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error('Save failed');
    appendImageItem(await res.json());
    btn.textContent = 'Saved ✓';
  } catch {
    btn.disabled    = false;
    btn.textContent = 'Save photo';
  }
}

/* ─── DOM helper ──────────────────────────────────────────── */

/**
 * @param {{id: string, url: string}} img
 */
function appendImageItem({ id, url }) {
  if (!imageList) return;

  if (emptyMsg) emptyMsg.hidden = true;

  const li  = document.createElement('li');
  li.className = 'med-image-item';

  const img = document.createElement('img');
  img.src       = url;
  img.alt       = 'Pill photo';
  img.className = 'med-image-thumb';
  img.loading   = 'lazy';

  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'med-image-delete';
  btn.setAttribute('aria-label', 'Remove photo');
  btn.dataset.deleteImage = id;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  li.append(img, btn);
  imageList.append(li);
}
