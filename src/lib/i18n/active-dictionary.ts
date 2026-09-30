import type { Dictionary } from "@/lib/i18n/dictionaries";
import { lookupServerMessage } from "@/lib/i18n/resolve";

/**
 * Holds the dictionary for the locale the client is currently rendering, so
 * code outside React (the apiFetch wrapper) can translate server messages
 * without every caller having to thread the context through.
 */
let activeDictionary: Dictionary | null = null;

export function setActiveDictionary(dictionary: Dictionary) {
  activeDictionary = dictionary;
}

/** English fallback when no provider has mounted yet. */
export function localizeServerMessage(message: string): string {
  return activeDictionary ? lookupServerMessage(activeDictionary, message) : message;
}
