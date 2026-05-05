/**
 * <details-menu>
 *
 * Enhances a <details> element with:
 *   - click-outside to close
 *   - Escape key to close (returns focus to <summary>)
 *   - [data-close] children that close the menu when activated
 *
 * The <details> works without JS via native toggle behavior.
 * This component only adds the missing UX affordances.
 *
 * Usage:
 *   <details-menu>
 *     <details class="...">
 *       <summary>...</summary>
 *       <div>
 *         ...
 *         <button data-close>Cancel</button>
 *       </div>
 *     </details>
 *   </details-menu>
 */
class DetailsMenu extends HTMLElement {
  /** @type {HTMLDetailsElement|null} */ #details = null;
  /** @type {HTMLElement|null} */ #summary = null;
  /** @type {(e: MouseEvent) => void} */ #onOutsideClick;
  /** @type {(e: KeyboardEvent) => void} */ #onKeydown;

  connectedCallback() {
    this.#details = /** @type {HTMLDetailsElement|null} */ (this.querySelector('details'));
    this.#summary = /** @type {HTMLElement|null} */ (this.querySelector('summary'));
    if (!this.#details) return;

    this.#onOutsideClick = (e) => {
      if (this.#details?.open && !this.contains(/** @type {Node} */ (e.target))) {
        this.#details.open = false;
      }
    };

    this.#onKeydown = (e) => {
      if (e.key === 'Escape' && this.#details?.open) {
        this.#details.open = false;
        this.#summary?.focus();
      }
    };

    document.addEventListener('click', this.#onOutsideClick);
    document.addEventListener('keydown', this.#onKeydown);

    this.querySelectorAll('[data-close]').forEach((el) =>
      el.addEventListener('click', () => { if (this.#details) this.#details.open = false; })
    );
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.#onOutsideClick);
    document.removeEventListener('keydown', this.#onKeydown);
  }
}

customElements.define('details-menu', DetailsMenu);
