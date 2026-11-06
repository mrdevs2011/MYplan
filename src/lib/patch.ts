/** Only the fields whose value actually changed. Sending the whole row would overwrite a different field that
 *  another device edited in the meantime. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(value ?? null) !== JSON.stringify(before[key] ?? null)) changed[key] = value;
  }
  return changed;
}
