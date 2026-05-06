(function () {
  const modal      = document.getElementById('med-info-modal');
  if (!modal) return;

  const titleEl    = document.getElementById('med-info-title');
  const subtitleEl = modal.querySelector('.med-info-modal__subtitle');
  const loadingEl  = modal.querySelector('.med-info-modal__loading');
  const imagesEl   = modal.querySelector('.med-info-modal__images');
  const noImagesEl = modal.querySelector('.med-info-modal__no-images');

  document.querySelectorAll('.grid-med-info-btn').forEach((btn) => {
    btn.addEventListener('click', () => openMedInfo(btn));
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  /**
   * @param {HTMLButtonElement} btn
   */
  async function openMedInfo(btn) {
    const name     = btn.dataset.medName ?? '';
    const strength = btn.dataset.medStrength ?? '';
    const rxcui    = btn.dataset.rxcui ?? '';

    titleEl.textContent    = name;
    subtitleEl.textContent = strength;

    imagesEl.innerHTML = '';
    imagesEl.hidden    = true;
    noImagesEl.hidden  = true;
    loadingEl.hidden   = false;

    modal.showModal();

    try {
      const res    = await fetch(`/api/meds/images/${encodeURIComponent(rxcui)}`);
      const images = await res.json();

      loadingEl.hidden = true;

      if (!Array.isArray(images) || !images.length) {
        noImagesEl.hidden = false;
        return;
      }

      imagesEl.hidden = false;
      for (const img of images) {
        const figure = document.createElement('figure');
        figure.className = 'med-info-img';
        figure.setAttribute('role', 'listitem');

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
        imagesEl.append(figure);
      }
    } catch {
      loadingEl.hidden  = true;
      noImagesEl.hidden = false;
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
