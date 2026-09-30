import type { Dictionary } from "./dictionaries";

/** Walks a dot-path (e.g. "nav.dashboard") and returns the leaf string. */
export function resolveValue(dictionary: Dictionary, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>(
    (node, part) =>
      node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
    dictionary
  );
  return typeof value === "string" ? value : undefined;
}

/**
 * API routes answer with English text, so the client looks the exact message
 * up in the dictionary; anything unknown is passed through untouched.
 */
export function lookupServerMessage(dictionary: Dictionary, message: string): string {
  const messages = dictionary.common.serverMessages as Record<string, string>;
  return messages[message] ?? message;
}

/**
 * Translates a raw DB enum (sale status, role, payment method). Unknown values
 * pass through, so a new enum never renders as a raw key.
 */
export function translateEnum(dictionary: Dictionary, value: string): string {
  const labels = dictionary.common.enumLabels as Record<string, string>;
  return labels[value] ?? value;
}
