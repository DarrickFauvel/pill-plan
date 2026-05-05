/**
 * <med-search next-focus="element-id">
 *
 * Keyboard navigation for the RxNorm typeahead. Progressive enhancement only —
 * search and selection work without JS. This adds:
 *   - ArrowDown from input → moves focus into results list
 *   - ArrowDown / ArrowUp within results → moves between buttons
 *   - Tab on a result button → selects it and advances to next-focus target
 *   - Escape → returns focus to the input
 *
 * Attributes:
 *   next-focus  id of the element to focus after a result is selected
 */
class MedSearch extends HTMLElement {
  connectedCallback() {
    /** @type {HTMLInputElement | null} */
    const input = this.querySelector('input[type="search"]');
    /** @type {HTMLElement | null} */
    const results = this.querySelector('[role="listbox"]');
    const nextId = this.getAttribute('next-focus');

    if (!input || !results) return;

    const focusNext = () => {
      if (!nextId) return;
      const target = /** @type {HTMLElement | null} */ (document.getElementById(nextId));
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => target.focus(), 60);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      /** @type {HTMLButtonElement | null} */ (results.querySelector('button'))?.focus();
    });

    results.addEventListener('keydown', (e) => {
      const btn = /** @type {HTMLButtonElement | null} */ (
        /** @type {Element} */ (e.target).closest('button')
      );
      if (!btn) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        (/** @type {HTMLButtonElement | null} */ (btn.nextElementSibling) ?? btn).focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = /** @type {HTMLButtonElement | null} */ (btn.previousElementSibling);
        prev ? prev.focus() : input.focus();
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        btn.click();
        focusNext();
      } else if (e.key === 'Escape') {
        input.focus();
      }
    });

    results.addEventListener('click', (e) => {
      if (/** @type {Element} */ (e.target).closest('button')) focusNext();
    });
  }
}

customElements.define('med-search', MedSearch);
