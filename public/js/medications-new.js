/**
 * Add medication page — pill photo selection and preview management.
 * Tracks photos client-side; they're uploaded on form submit.
 */

const imageList      = document.getElementById('med-image-list');
const emptyMsg       = document.getElementById('med-image-empty');
const cameraInput    = /** @type {HTMLInputElement} */ (document.getElementById('camera-input'));
const captureInput   = /** @type {HTMLInputElement} */ (document.getElementById('camera-capture-input'));
const imageUrlsInput = /** @type {HTMLInputElement} */ (document.getElementById('image-urls-input'));

/* ─── Uploaded files tracking ─────────────────────────────── */

/** @type {Map<string, File>} */
const uploadedFiles = new Map();

/** @param {HTMLInputElement} input */
function handleFileInput(input) {
  for (const file of Array.from(input.files ?? [])) {
    const id = uid();
    uploadedFiles.set(id, file);
    addUploadPreview(id, file);
  }
  input.value = '';
  syncFileInput();
}

cameraInput?.addEventListener('change', () => handleFileInput(cameraInput));
captureInput?.addEventListener('change', () => handleFileInput(captureInput));

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
    appendPreview(id, /** @type {string} */ (e.target?.result));
  };
  reader.readAsDataURL(file);
}

/* ─── URL input ───────────────────────────────────────────── */

/** @type {Set<string>} */
const selectedUrls = new Set();

const urlInput  = /** @type {HTMLInputElement} */ (document.getElementById('image-url-input'));
const addUrlBtn = document.getElementById('add-image-url-btn');

addUrlBtn?.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url || !/^https?:\/\/.+/.test(url) || selectedUrls.has(url)) return;
  selectedUrls.add(url);
  imageUrlsInput.value = JSON.stringify([...selectedUrls]);
  showEmptyMsg(false);
  appendPreview(uid(), url, url);
  urlInput.value = '';
});

urlInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addUrlBtn?.click(); }
});

/* ─── Preview list ────────────────────────────────────────── */

/**
 * @param {string} id       - upload tracking key (or random id for URL previews)
 * @param {string} src      - data URL or image URL
 * @param {string} [urlKey] - if set, remove from selectedUrls on delete
 */
function appendPreview(id, src, urlKey) {
  const li = document.createElement('li');
  li.className = 'med-image-item';

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
    if (urlKey) {
      selectedUrls.delete(urlKey);
      imageUrlsInput.value = JSON.stringify([...selectedUrls]);
    } else {
      uploadedFiles.delete(id);
      syncFileInput();
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

/* ─── Utility ─────────────────────────────────────────────── */

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ─── Init: hide empty message if photos exist ────────────── */
if (imageList && !imageList.children.length && emptyMsg) {
  emptyMsg.hidden = false;
}
