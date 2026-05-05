/**
 * <autosave-form debounce="600">
 *
 * Wraps a <form> and debounces change events into a fetch POST.
 * The form still submits normally without JS.
 * Save state is reflected on the child element with [data-save-status].
 *
 * Usage:
 *   <autosave-form debounce="600">
 *     <form action="/api/...">
 *       ...
 *       <p data-save-status role="status" aria-live="polite" aria-atomic="true"></p>
 *     </form>
 *   </autosave-form>
 */
class AutosaveForm extends HTMLElement {
  connectedCallback() {
    const form = /** @type {HTMLFormElement|null} */ (this.querySelector('form'));
    const status = /** @type {HTMLElement|null} */ (this.querySelector('[data-save-status]'));
    if (!form) return;

    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    const delay = Number(this.getAttribute('debounce') ?? 600);

    const save = async () => {
      if (status) { status.textContent = 'Saving…'; status.dataset.state = 'saving'; }
      try {
        const resp = await fetch(form.action, {
          method: 'POST',
          body: new URLSearchParams(/** @type {any} */ (new FormData(form))),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-fetch': '1' },
        });
        if (!resp.ok) throw new Error('save failed');
        if (status) { status.textContent = 'Saved'; status.dataset.state = 'saved'; }
      } catch {
        if (status) { status.textContent = 'Not saved'; status.dataset.state = 'error'; }
      }
    };

    form.addEventListener('change', () => {
      clearTimeout(timer);
      if (status) { status.textContent = ''; delete status.dataset.state; }
      timer = setTimeout(save, delay);
    });
  }
}

customElements.define('autosave-form', AutosaveForm);
