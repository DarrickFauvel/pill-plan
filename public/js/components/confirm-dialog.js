/**
 * <confirm-dialog>
 *
 * Wraps a <dialog> and its trigger. The HTML is valid without JS;
 * this component wires showModal / close / backdrop-click.
 *
 * Usage:
 *   <confirm-dialog>
 *     <button data-trigger>Open</button>
 *     <dialog>
 *       ...
 *       <button data-close>Cancel</button>
 *     </dialog>
 *   </confirm-dialog>
 */
class ConfirmDialog extends HTMLElement {
  connectedCallback() {
    const dialog = /** @type {HTMLDialogElement|null} */ (this.querySelector('dialog'));
    if (!dialog) return;

    this.querySelector('[data-trigger]')?.addEventListener('click', () => dialog.showModal());

    this.querySelectorAll('[data-close]').forEach((btn) =>
      btn.addEventListener('click', () => dialog.close())
    );

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
}

customElements.define('confirm-dialog', ConfirmDialog);
