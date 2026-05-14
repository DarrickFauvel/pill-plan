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

/**
 * @param {HTMLInputElement} input
 */
async function handlePhotoInput(input) {
  const file = input.files?.[0];
  if (!file) return;

  const fd = new FormData();
  fd.append('photo', file);
  input.value = '';

  try {
    const res = await fetch(`/api/medications/${medId}/images/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Upload failed');
    appendImageItem(await res.json());
  } catch {
    // silently fail — user can retry by selecting again
  }
}

document.getElementById('camera-capture-input')?.addEventListener('change', (e) => {
  handlePhotoInput(/** @type {HTMLInputElement} */ (e.currentTarget));
});

document.getElementById('camera-input')?.addEventListener('change', (e) => {
  handlePhotoInput(/** @type {HTMLInputElement} */ (e.currentTarget));
});

/* ─── URL input ───────────────────────────────────────────── */

const urlInput  = /** @type {HTMLInputElement} */ (document.getElementById('image-url-input'));
const addUrlBtn = document.getElementById('add-image-url-btn');

addUrlBtn?.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url || !/^https?:\/\/.+/.test(url)) return;

  /** @type {HTMLButtonElement} */ (addUrlBtn).disabled = true;
  try {
    const res = await fetch(`/api/medications/${medId}/images/url`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error('Failed');
    appendImageItem(await res.json());
    urlInput.value = '';
  } catch {
    // silently fail — bad URL or server error
  } finally {
    /** @type {HTMLButtonElement} */ (addUrlBtn).disabled = false;
  }
});

urlInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addUrlBtn?.click(); }
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
