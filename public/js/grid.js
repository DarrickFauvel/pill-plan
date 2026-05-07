(function () {
  const modal        = document.getElementById('med-info-modal');
  if (!modal) return;

  const titleEl      = document.getElementById('med-info-title');
  const subtitleEl   = modal.querySelector('.med-info-modal__subtitle');
  const statusEl     = document.getElementById('med-info-status');
  const loadingEl     = modal.querySelector('.med-info-modal__loading');
  const noImagesEl    = modal.querySelector('.med-info-modal__no-images');
  const savedImagesEl = document.getElementById('med-info-saved-images');

  /** @type {Map<string, Array<{id:string,url:string}>>} */
  const cache = new Map();

  document.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('.grid-med-info-btn');
    if (btn) openMedInfo(/** @type {HTMLButtonElement} */ (btn));
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  /** @param {HTMLButtonElement} btn */
  async function openMedInfo(btn) {
    const { medName: name = '', medStrength: strength = '', medId = '' } = btn.dataset;

    titleEl.textContent    = name;
    subtitleEl.textContent = strength;
    statusEl.textContent   = 'Loading…';

    savedImagesEl.hidden    = true;
    noImagesEl.hidden       = true;
    savedImagesEl.innerHTML = '';
    loadingEl.hidden        = false;

    modal.showModal();

    try {
      const images = cache.has(medId)
        ? cache.get(medId)
        : await fetch(`/api/medications/${encodeURIComponent(medId)}/images`).then((r) => r.json());

      if (!cache.has(medId)) cache.set(medId, Array.isArray(images) ? images : []);

      const list = cache.get(medId);

      if (list.length) {
        for (const img of list) {
          const li    = document.createElement('li');
          li.className = 'med-info-img';

          const photo = document.createElement('img');
          photo.src       = img.url;
          photo.alt       = 'Pill photo';
          photo.className = 'med-info-img__photo';
          photo.loading   = 'lazy';

          li.append(photo);
          savedImagesEl.append(li);
        }
        savedImagesEl.hidden = false;
      } else {
        noImagesEl.hidden = false;
      }

      statusEl.textContent = '';
    } catch {
      noImagesEl.hidden    = false;
      statusEl.textContent = 'Could not load photos. Please try again.';
    } finally {
      loadingEl.hidden = true;
    }
  }
})();
