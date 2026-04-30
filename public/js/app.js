/** @import { } from './types.js' */

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

/**
 * Auto-reset the $saveStatus signal to 'idle' 2s after it reaches 'saved'.
 * Datastar exposes its signals store at window.__ds after initialization.
 * We dispatch a datastar-merge-signals event so Datastar handles the update.
 *
 * @param {string} status
 */
function resetSaveStatus(status) {
  if (status !== 'saved') return;
  clearTimeout(window.__saveTimer);
  window.__saveTimer = setTimeout(() => {
    document.dispatchEvent(
      new CustomEvent('datastar-merge-signals', {
        detail: { signals: { saveStatus: 'idle' } },
        bubbles: true,
      })
    );
  }, 2000);
}

// Watch the save indicator element for Datastar-driven visibility changes
const saveIndicator = document.getElementById('save-indicator');
if (saveIndicator) {
  const observer = new MutationObserver(() => {
    const status = saveIndicator.dataset.saveStatus;
    if (status) resetSaveStatus(status);
  });
  observer.observe(saveIndicator, { attributes: true, attributeFilter: ['data-save-status'] });
}
