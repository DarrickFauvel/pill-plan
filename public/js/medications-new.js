/**
 * Add medication page — pill photo selection and preview management.
 * Tracks photos client-side; they're uploaded on form submit.
 */

const imageList      = document.getElementById('med-image-list');
const emptyMsg       = document.getElementById('med-image-empty');
const imageUrlsInput = /** @type {HTMLInputElement} */ (document.getElementById('image-urls-input'));
const cameraInput    = /** @type {HTMLInputElement} */ (document.getElementById('camera-input'));

/* ─── Uploaded files tracking ─────────────────────────────── */

/** @type {Map<string, File>} */
const uploadedFiles = new Map();

cameraInput?.addEventListener('change', () => {
  for (const file of Array.from(cameraInput.files ?? [])) {
    const id = uid();
    uploadedFiles.set(id, file);
    addUploadPreview(id, file);
  }
  cameraInput.value = '';
  syncFileInput();
});

/** Rebuild the file input's FileList from uploadedFiles. */
function syncFileInput() {
  const dt = new DataTransfer();
  for (const f of uploadedFiles.values()) dt.items.add(f);
  cameraInput.files = dt.files;
}

/**
 * @param {string} id
 * @param {File} file
 */
function addUploadPreview(id, file) {
  showEmptyMsg(false);
  const reader = new FileReader();
  reader.onload = (e) => {
    const src = /** @type {string} */ (e.target?.result);
    appendPreview(id, src, 'upload');
  };
  reader.readAsDataURL(file);
}

/* ─── API image URLs tracking ─────────────────────────────── */

/** @type {Set<string>} */
const selectedUrls = new Set();

function syncUrlInput() {
  imageUrlsInput.value = JSON.stringify([...selectedUrls]);
}

/**
 * @param {string} url
 * @param {HTMLButtonElement} btn
 */
function addApiImage(url, btn) {
  if (selectedUrls.has(url)) {
    btn.textContent = 'Already saved';
    return;
  }
  selectedUrls.add(url);
  syncUrlInput();
  showEmptyMsg(false);
  appendPreview(uid(), url, 'api', url);
  btn.textContent = 'Saved ✓';
  btn.disabled    = true;
}

/* ─── Shared preview list ─────────────────────────────────── */

/**
 * @param {string} id
 * @param {string} src     - data URL (upload) or image URL (api)
 * @param {'upload'|'api'} source
 * @param {string} [apiUrl] - original URL, needed for api source removal
 */
function appendPreview(id, src, source, apiUrl) {
  const li  = document.createElement('li');
  li.id           = `preview-${id}`;
  li.className    = 'med-image-item';
  li.dataset.previewId = id;

  const img = document.createElement('img');
  img.src       = src;
  img.alt       = 'Pill photo';
  img.className = 'med-image-thumb';
  img.loading   = 'lazy';

  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'med-image-delete';
  btn.setAttribute('aria-label', 'Remove photo');
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  btn.addEventListener('click', () => {
    if (source === 'upload') {
      uploadedFiles.delete(id);
      syncFileInput();
    } else if (apiUrl) {
      selectedUrls.delete(apiUrl);
      syncUrlInput();
    }
    li.remove();
    if (!imageList?.children.length) showEmptyMsg(true);
  });

  li.append(img, btn);
  imageList?.append(li);
}

function showEmptyMsg(visible) {
  if (emptyMsg) emptyMsg.hidden = !visible;
}

/* ─── API images browser modal ────────────────────────────── */

const modal     = /** @type {HTMLDialogElement|null} */ (document.getElementById('api-images-modal'));
const browseBtn = document.getElementById('browse-api-images-btn');
const closeBtn  = document.getElementById('close-api-images');
const apiList   = document.getElementById('api-images-list');
const apiStatus = document.getElementById('api-images-status');

/** @type {Map<string, Array<{url:string,name:string,shape:string,color:string,imprint:string}>>} */
const apiCache = new Map();

browseBtn?.addEventListener('click', () => {
  const rxcui = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="rxcui"]'))?.value;
  if (!rxcui) return;
  modal?.showModal();
  loadApiImages(rxcui);
});

closeBtn?.addEventListener('click', () => modal?.close());
modal?.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

/** @param {string} rxcui */
async function loadApiImages(rxcui) {
  if (!apiList || !apiStatus) return;

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
      caption.className = 'api-image-caption';
      const parts = [];
      if (img.shape)   parts.push(img.shape);
      if (img.color)   parts.push(img.color);
      if (img.imprint) parts.push(`"${img.imprint}"`);
      caption.textContent = parts.join(' · ') || img.name || '';

      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'btn btn--primary btn--sm api-image-select-btn';
      btn.textContent = selectedUrls.has(img.url) ? 'Saved ✓' : 'Save photo';
      if (selectedUrls.has(img.url)) btn.disabled = true;
      btn.addEventListener('click', () => addApiImage(img.url, btn));

      li.append(photo, caption, btn);
      apiList.append(li);
    }
  } catch {
    apiStatus.textContent = 'Could not load pill photos. Please try again.';
  }
}

/* ─── Utility ─────────────────────────────────────────────── */

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ─── Init: hide empty message if photos exist ────────────── */
if (imageList && !imageList.children.length && emptyMsg) {
  emptyMsg.hidden = false;
}
