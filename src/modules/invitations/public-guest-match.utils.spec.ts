import {
  guestNameSimilarity,
  guestPhonesMatch,
  normalizeGuestName,
  publicGuestMatchScore,
} from './public-guest-match.utils';

describe('public guest matching', () => {
  it('normalizes accents, spacing and name order', () => {
    expect(normalizeGuestName('  José   María Pérez ')).toBe('jose maria perez');
    expect(guestNameSimilarity('José María Pérez', 'Perez, Jose Maria')).toBeGreaterThan(0.98);
  });

  it('accepts common Argentine phone formats by significant digits', () => {
    expect(guestPhonesMatch('+54 9 11 4567-8910', '011 15-4567-8910')).toBe(true);
    expect(guestPhonesMatch('11 4567-8910', '15 4567-8910')).toBe(true);
  });

  it('tolerates small name differences only when the phone also matches', () => {
    expect(publicGuestMatchScore(
      { name: 'Rodrigo Aunins', phone: '+54 9 11 4567-8910' },
      { name: 'Rodri Aunins', phone: '011 15-4567-8910' },
    )).toBeGreaterThan(70);
    expect(publicGuestMatchScore(
      { name: 'Carolina Gomez', phone: '11 4567-8910' },
      { name: 'Rodrigo Aunins', phone: '11 4567-8910' },
    )).toBe(0);
  });
});
