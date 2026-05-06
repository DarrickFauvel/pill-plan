(function () {
  const modal      = document.getElementById('med-info-modal');
  if (!modal) return;

  const titleEl    = document.getElementById('med-info-title');
  const subtitleEl = modal.querySelector('.med-info-modal__subtitle');
  const statusEl   = document.getElementById('med-info-status');
  const loadingEl  = modal.querySelector('.med-info-modal__loading');
  const imagesEl   = modal.querySelector('.med-info-modal__images');
  const noImagesEl = modal.querySelector('.med-info-modal__no-images');

  /** @type {Map<string, Array<{url:string,name:string,shape:string,color:string,imprint:string}>>} */
  const imageCache = new Map();

  document.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('.grid-med-info-btn');
    if (btn) openMedInfo(/** @type {HTMLButtonElement} */ (btn));
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  /**
   * @param {HTMLButtonElement} btn
   */
  async function openMedInfo(btn) {
    const { medName: name = '', medStrength: strength = '', rxcui = '' } = btn.dataset;

    titleEl.textContent    = name;
    subtitleEl.textContent = strength;
    statusEl.textContent   = 'Loading images…';

    imagesEl.innerHTML = '';
    imagesEl.hidden    = true;
    noImagesEl.hidden  = true;
    loadingEl.hidden   = false;

    modal.showModal();

    try {
      const images = imageCache.has(rxcui)
        ? imageCache.get(rxcui)
        : await fetch(`/api/meds/images/${encodeURIComponent(rxcui)}`).then((r) => r.json());

      if (!imageCache.has(rxcui)) imageCache.set(rxcui, images);

      if (!Array.isArray(images) || !images.length) {
        noImagesEl.hidden  = false;
        statusEl.textContent = 'No pill images are available for this medication.';
        return;
      }

      imagesEl.hidden      = false;
      statusEl.textContent = '';

      for (const img of images) {
        const li = document.createElement('li');
        li.className = 'med-info-img';

        const figure = document.createElement('figure');
        figure.className = 'med-info-img__figure';

        const photo = document.createElement('img');
        photo.src       = img.url;
        photo.alt       = buildAlt(img);
        photo.className = 'med-info-img__photo';
        photo.loading   = 'lazy';

        const caption = document.createElement('figcaption');
        caption.className = 'med-info-img__caption';
        const parts = [img.shape, img.color, img.imprint ? `Imprint: ${img.imprint}` : ''].filter(Boolean);
        caption.textContent = parts.join(' · ') || img.name;

        figure.append(photo, caption);
        li.append(figure);
        imagesEl.append(li);
      }
    } catch {
      noImagesEl.hidden    = false;
      statusEl.textContent = 'No pill images are available for this medication.';
    } finally {
      loadingEl.hidden = true;
    }
  }

  /**
   * @param {{name: string, shape: string, color: string, imprint: string}} img
   * @returns {string}
   */
  function buildAlt(img) {
    const parts = [img.name];
    if (img.shape)   parts.push(img.shape);
    if (img.color)   parts.push(img.color);
    if (img.imprint) parts.push(`imprint: ${img.imprint}`);
    return parts.join(', ');
  }
})();
