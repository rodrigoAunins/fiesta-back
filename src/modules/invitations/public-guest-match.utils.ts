export type PublicGuestIdentity = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export function normalizeGuestName(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeGuestPhone(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function levenshteinDistance(left: string, right: string): number {
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function guestNameSimilarity(leftValue: unknown, rightValue: unknown): number {
  const left = normalizeGuestName(leftValue);
  const right = normalizeGuestName(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftSorted = left.split(' ').sort().join(' ');
  const rightSorted = right.split(' ').sort().join(' ');
  if (leftSorted === rightSorted) return 0.99;

  const editSimilarity = 1 - (levenshteinDistance(left, right) / Math.max(left.length, right.length));
  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const sharedTokens = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenSimilarity = (2 * sharedTokens) / (leftTokens.size + rightTokens.size);
  return Math.max(editSimilarity, tokenSimilarity * 0.96);
}

export function guestPhonesMatch(leftValue: unknown, rightValue: unknown): boolean {
  const left = normalizeGuestPhone(leftValue);
  const right = normalizeGuestPhone(rightValue);
  if (left.length < 8 || right.length < 8) return false;
  if (left === right) return true;
  return left.slice(-8) === right.slice(-8);
}

export function publicGuestMatchScore(candidate: PublicGuestIdentity, requested: PublicGuestIdentity): number {
  const requestedEmail = String(requested.email || '').trim().toLowerCase();
  const candidateEmail = String(candidate.email || '').trim().toLowerCase();
  if (requestedEmail && candidateEmail && requestedEmail === candidateEmail) return 100;

  if (!guestPhonesMatch(candidate.phone, requested.phone)) return 0;
  const nameSimilarity = guestNameSimilarity(candidate.name, requested.name);
  if (nameSimilarity < 0.62) return 0;

  const candidatePhone = normalizeGuestPhone(candidate.phone);
  const requestedPhone = normalizeGuestPhone(requested.phone);
  const exactPhoneBonus = candidatePhone === requestedPhone ? 8 : 0;
  const tenDigitBonus = candidatePhone.slice(-10) === requestedPhone.slice(-10) ? 4 : 0;
  return 60 + (nameSimilarity * 28) + exactPhoneBonus + tenDigitBonus;
}
