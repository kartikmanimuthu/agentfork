/**
 * Keeps a Base UI dialog open when the press that would dismiss it actually landed
 * inside a Radix popup.
 *
 * **Why this is needed.** The dialogs and sheets are Base UI
 * (`@base-ui/react/dialog`); `Select` is Radix (`@radix-ui/react-select`). Two
 * different popup libraries, each with its own portal and its own outside-press
 * detection, and neither knows about the other's layers. Radix renders its dropdown
 * into a portal at the end of `<body>`, so it is not a DOM descendant of the Base UI
 * popup — which means pressing a dropdown option reads to Base UI as a press
 * OUTSIDE the dialog, and it dismisses the whole form.
 *
 * It bites hardest on touch. A mouse user's press on a Radix item is consumed by
 * Radix's own pointer handling before Base UI's outside-press listener resolves; a
 * tap produces a different event sequence, so on a phone the form closes the moment
 * you try to pick an option from a dropdown — losing everything typed so far.
 *
 * The narrow fix rather than the blunt one: Base UI offers
 * `disablePointerDismissal`, but turning that on would ALSO stop a genuine tap on
 * the backdrop from closing the form, which is behaviour worth keeping. This
 * cancels the dismissal only when the press came from a foreign popup layer, so an
 * outside tap, the X button and Escape all still close the dialog.
 *
 * The real cure is one popup library for both. Until then this is the seam.
 */

/**
 * Markers for content Radix renders in its own portal.
 *
 * Several selectors because Radix's internals are not a stable contract and
 * different components mark their layers differently — the popper wrapper covers
 * Select/Popover/DropdownMenu, and the role/slot fallbacks catch a layer that stops
 * carrying a `data-radix-*` attribute after an upgrade. Over-matching here is safe:
 * the only consequence is that a dialog stays open on a press it could have closed
 * on, whereas under-matching loses the user's form.
 */
const FOREIGN_POPUP_SELECTORS = [
  '[data-radix-popper-content-wrapper]',
  '[data-radix-portal]',
  '[data-radix-select-viewport]',
  '[data-slot="select-content"]',
  '[role="listbox"]',
  '[role="menu"]',
].join(',');

function isInsideForeignPopup(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(FOREIGN_POPUP_SELECTORS) !== null;
}

/** The Base UI change reasons that a foreign popup can trigger by accident. */
const DISMISSAL_REASONS = new Set(['outside-press', 'focus-out']);

/**
 * True when a close should be ignored because it originated inside another
 * library's popup.
 *
 * Deliberately narrow: only `outside-press` and `focus-out` are ever cancelled.
 * `close-press` (the X and Cancel buttons), `escape-key` and any programmatic close
 * pass through untouched, so nothing here can trap a user in a dialog.
 */
export function isForeignPopupDismissal(details: {
  reason: string;
  event?: Event | null;
}): boolean {
  if (!DISMISSAL_REASONS.has(details.reason)) return false;
  const event = details.event;
  if (!event) return false;
  // `focus-out` reports the element LOSING focus as the target, so the element
  // gaining it — the Radix item — is on relatedTarget.
  const related = (event as FocusEvent).relatedTarget ?? null;
  return isInsideForeignPopup(event.target) || isInsideForeignPopup(related);
}
