/**
 * mask.ts — one masking rule for every connector secret.
 *
 * The design reference (§6) specifies `len <= 8 ? '********' : first4 + '****'
 * + last4`. Nucleus duplicates that function verbatim across five route files;
 * it lives here once instead.
 */

const SHORT_MASK = '********';

/** Masks a secret for display. Returns '' for empty/absent input so the UI can distinguish "unset". */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 8) return SHORT_MASK;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
