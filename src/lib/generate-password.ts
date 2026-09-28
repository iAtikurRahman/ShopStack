const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

function randomInt(max: number): number {
  // Rejection sampling keeps the distribution uniform across the alphabet.
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

/**
 * Generates a random password that always satisfies validatePassword: at least
 * one letter and one number, 16 characters by default. The leading character is
 * pinned to a letter so the result never trips a "must start with a letter" rule.
 */
export function generatePassword(length = 16): string {
  const size = Math.max(16, length);
  const chars = [pick(LOWER + UPPER), pick(LOWER + UPPER), pick(DIGITS), pick(DIGITS)];

  while (chars.length < size) {
    chars.push(pick(ALL));
  }

  // Fisher-Yates so the guaranteed characters are not stuck at the front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
