/**
 * <days-picker>
 *
 * Enhances a group of day-of-week checkboxes with an "All" toggle.
 * Scoped to its own subtree so no data-slot-id bookkeeping is needed.
 *
 * Usage:
 *   <days-picker class="slot-days" role="group" aria-label="...">
 *     <button type="button" class="day-toggle day-toggle--all" aria-pressed="true">All</button>
 *     <label class="day-toggle"><input type="checkbox" ...><span>Su</span></label>
 *     ...
 *   </days-picker>
 */
class DaysPicker extends HTMLElement {
  connectedCallback() {
    const allBtn = /** @type {HTMLButtonElement|null} */ (this.querySelector('.day-toggle--all'));
    const boxes = /** @type {NodeListOf<HTMLInputElement>} */ (
      this.querySelectorAll('input[type="checkbox"]')
    );
    if (!allBtn || !boxes.length) return;

    const sync = () => {
      allBtn.setAttribute('aria-pressed', [...boxes].every((b) => b.checked) ? 'true' : 'false');
    };

    allBtn.addEventListener('click', () => {
      const allChecked = [...boxes].every((b) => b.checked);
      boxes.forEach((b) => { b.checked = !allChecked; });
      sync();
      this.closest('form')?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    boxes.forEach((b) => b.addEventListener('change', sync));
  }
}

customElements.define('days-picker', DaysPicker);
