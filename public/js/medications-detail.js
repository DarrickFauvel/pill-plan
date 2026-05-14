/**
 * Medication detail page — pill photo management.
 * Handles camera/gallery upload (with crop) and re-crop of existing photos.
 */

const gallery   = document.getElementById('med-images');
const medId     = gallery?.dataset.medId;
const imageList = document.getElementById('med-image-list');
const emptyMsg  = document.getElementById('med-image-empty');

if (!medId) throw new Error('med-images element missing');

/* ─── Crop modal ───────────────────────────────────────────── */

const cropModal      = /** @type {HTMLDialogElement} */ (document.getElementById('crop-modal'));
const cropPreview    = /** @type {HTMLImageElement}  */ (document.getElementById('crop-preview'));
const cropConfirmBtn = document.getElementById('crop-confirm-btn');
const cropCancelBtn  = document.getElementById('crop-cancel-btn');

/** @type {Cropper | null} */
let cropper = null;

const RESIZE_ACTIONS = new Set(['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw']);
/** @type {{ x: number, y: number } | null} */
let cropCenter  = null;
let isAdjusting = false;

/**
 * Pending original File for a new upload (set before crop modal opens).
 * @type {File | null}
 */
let pendingFile = null;

/**
 * Image ID being re-cropped (set when re-crop flow is active).
 * @type {string | null}
 */
let recropImageId = null;

/**
 * Open the crop modal.
 * @param {string} src  - data URL or https URL to load into Cropper
 * @param {{ x: number, y: number, width: number, height: number } | null} [initialCrop]
 */
function openCropModal(src, initialCrop) {
  cropPreview.src = src;
  cropModal.showModal();

  cropPreview.onload = () => {
    if (cropper) { cropper.destroy(); cropper = null; }
    cropper = new Cropper(cropPreview, {
      aspectRatio: 1,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.92,
      restore: false,
      guides: true,
      center: true,
      highlight: false,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
      ready() {
        if (initialCrop) cropper?.setData(initialCrop);
      },
      cropstart(e) {
        if (RESIZE_ACTIONS.has(e.detail.action)) {
          const box = cropper.getCropBoxData();
          cropCenter = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }
      },
      cropmove(e) {
        if (!cropCenter || isAdjusting || !RESIZE_ACTIONS.has(e.detail.action)) return;
        isAdjusting = true;
        requestAnimationFrame(() => {
          const box = cropper.getCropBoxData();
          cropper.setCropBoxData({
            left: cropCenter.x - box.width  / 2,
            top:  cropCenter.y - box.height / 2,
          });
          isAdjusting = false;
        });
      },
      cropend() {
        cropCenter  = null;
        isAdjusting = false;
      },
    });
  };
}

function closeCropModal() {
  cropModal.close();
  if (cropper) { cropper.destroy(); cropper = null; }
  pendingFile   = null;
  recropImageId = null;
  cropCenter    = null;
  isAdjusting   = false;
}

cropCancelBtn?.addEventListener('click', closeCropModal);
cropModal?.addEventListener('click', (e) => { if (e.target === cropModal) closeCropModal(); });

const CROP_STEP = 20;

/** @param {number} delta */
function adjustCropSize(delta) {
  if (!cropper) return;
  const box    = cropper.getCropBoxData();
  const canvas = cropper.getCanvasData();
  const newSize = Math.max(40, Math.min(Math.min(canvas.width, canvas.height), box.width + delta));
  const cx = box.left + box.width  / 2;
  const cy = box.top  + box.height / 2;
  cropper.setCropBoxData({ width: newSize, height: newSize, left: cx - newSize / 2, top: cy - newSize / 2 });
}

document.getElementById('crop-plus-btn') ?.addEventListener('click', () => adjustCropSize(+CROP_STEP));
document.getElementById('crop-minus-btn')?.addEventListener('click', () => adjustCropSize(-CROP_STEP));

cropConfirmBtn?.addEventListener('click', async () => {
  if (!cropper) return;

  const cropData = (({ x, y, width, height }) => ({ x, y, width, height }))(cropper.getData(true));
  const file     = pendingFile;
  const imageId  = recropImageId;

  closeCropModal();

  if (file) {
    await uploadPhoto(file, cropData);
  } else if (imageId) {
    await submitRecrop(imageId, cropData);
  }
});

/* ─── Camera / gallery upload ─────────────────────────────── */

/**
 * @param {HTMLInputElement} input
 */
function handlePhotoInput(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  pendingFile   = file;
  recropImageId = null;

  const reader = new FileReader();
  reader.onload = (e) => openCropModal(/** @type {string} */ (e.target?.result));
  reader.readAsDataURL(file);
}

document.getElementById('camera-capture-input')?.addEventListener('change', (e) => {
  handlePhotoInput(/** @type {HTMLInputElement} */ (e.currentTarget));
});

document.getElementById('camera-input')?.addEventListener('change', (e) => {
  handlePhotoInput(/** @type {HTMLInputElement} */ (e.currentTarget));
});

/**
 * Upload the original file + crop coordinates.
 * @param {File} file
 * @param {{ x: number, y: number, width: number, height: number }} cropData
 */
async function uploadPhoto(file, cropData) {
  const statusEl = document.getElementById('photo-upload-error');
  if (statusEl) statusEl.hidden = true;
  if (emptyMsg) emptyMsg.hidden = true;

  const placeholder = document.createElement('li');
  placeholder.className = 'med-image-item med-image-item--uploading';
  placeholder.setAttribute('aria-label', 'Uploading photo…');
  placeholder.innerHTML = '<span class="med-image-spinner" aria-hidden="true"></span>';
  imageList?.append(placeholder);

  const fd = new FormData();
  fd.append('photo', file, file.name);
  fd.append('cropData', JSON.stringify(cropData));

  try {
    const res = await fetch(`/api/medications/${medId}/images/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Upload failed');
    placeholder.replaceWith(createImageItem(await res.json()));
  } catch {
    placeholder.remove();
    if (!imageList?.children.length && emptyMsg) emptyMsg.hidden = false;
    if (statusEl) statusEl.hidden = false;
  }
}

/* ─── Re-crop existing photo ───────────────────────────────── */

imageList?.addEventListener('click', (e) => {
  const btn = /** @type {Element} */ (e.target).closest('[data-recrop-image]');
  if (!btn) return;

  const li        = btn.closest('.med-image-item');
  const imageId   = /** @type {HTMLElement} */ (btn).dataset.recropImage;
  const origUrl   = /** @type {HTMLElement} */ (li).dataset.originalUrl ?? '';
  const cropRaw   = /** @type {HTMLElement} */ (li).dataset.cropData;

  /** @type {{ x: number, y: number, width: number, height: number } | null} */
  const initialCrop = cropRaw ? JSON.parse(cropRaw) : null;

  pendingFile   = null;
  recropImageId = imageId ?? null;

  openCropModal(origUrl, initialCrop);
});

/**
 * @param {string} imageId
 * @param {{ x: number, y: number, width: number, height: number }} cropData
 */
async function submitRecrop(imageId, cropData) {
  const statusEl = document.getElementById('photo-upload-error');
  if (statusEl) statusEl.hidden = true;

  try {
    const res = await fetch(`/api/medications/${medId}/images/${imageId}/recrop`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cropData: JSON.stringify(cropData) }),
    });
    if (!res.ok) throw new Error('Recrop failed');
    const { url } = await res.json();

    const li  = imageList?.querySelector(`[data-image-id="${imageId}"]`);
    const img = li?.querySelector('img');
    if (img) img.src = url;
    if (li) {
      /** @type {HTMLElement} */ (li).dataset.cropData = JSON.stringify(cropData);
    }
  } catch {
    if (statusEl) statusEl.hidden = false;
  }
}

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
 * @param {{ id: string, url: string, originalUrl?: string, cropData?: object | null }} img
 * @returns {HTMLLIElement}
 */
function createImageItem({ id, url, originalUrl, cropData }) {
  const li = document.createElement('li');
  li.className           = 'med-image-item';
  li.dataset.imageId     = id;
  li.dataset.originalUrl = originalUrl ?? url;
  if (cropData) li.dataset.cropData = JSON.stringify(cropData);

  const img = document.createElement('img');
  img.src       = url;
  img.alt       = 'Pill photo';
  img.className = 'med-image-thumb';
  img.loading   = 'lazy';

  const recropBtn = document.createElement('button');
  recropBtn.type      = 'button';
  recropBtn.className = 'med-image-recrop';
  recropBtn.setAttribute('aria-label', 'Re-crop photo');
  recropBtn.dataset.recropImage = id;
  recropBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';

  const deleteBtn = document.createElement('button');
  deleteBtn.type      = 'button';
  deleteBtn.className = 'med-image-delete';
  deleteBtn.setAttribute('aria-label', 'Remove photo');
  deleteBtn.dataset.deleteImage = id;
  deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  li.append(img, recropBtn, deleteBtn);
  return li;
}

/**
 * @param {{ id: string, url: string, originalUrl?: string, cropData?: object | null }} img
 */
function appendImageItem(img) {
  if (!imageList) return;
  if (emptyMsg) emptyMsg.hidden = true;
  imageList.append(createImageItem(img));
}
