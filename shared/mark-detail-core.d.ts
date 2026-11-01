/** Fields a mark stores, pulled out of a raw OpenStreetMap tag set. */
export function markDetailFields(tags: Record<string, string | undefined> | null | undefined): {
  fields: Record<string, string>;
  details: Record<string, string>;
};
/** Card label for a raw OpenStreetMap tag key. */
export function markDetailLabel(key: string): string;
/** Card rows for a mark's details, as [label, value] pairs. */
export function markDetailRows(details: Record<string, string> | null | undefined): [string, string][];
