/** BUG-0281: Der Geräte-Kurzlabel am eigenen Chat-Eintrag ist nur Information,
 * wenn mehrere verschiedene Akteure im Chat erscheinen. Mit genau einem
 * Akteur ist er mehrdeutig oder veraltet und soll dem nackten „Du“ weichen
 * (Label bleibt als tooltipbarer hovering-Hinweis erhalten). */
export function showActorSuffix(actors: readonly (string | null | undefined)[]): boolean {
  const distinct = new Set(actors.filter((a) => typeof a === "string" && a !== ""));
  return distinct.size > 1;
}
