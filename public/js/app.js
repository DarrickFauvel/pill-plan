import './components/confirm-dialog.js';
import './components/days-picker.js';
import './components/autosave-form.js';
import './components/details-menu.js';
import './components/med-search.js';

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
