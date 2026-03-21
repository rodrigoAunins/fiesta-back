export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildRafflePricing(params: {
  desiredNetGoal: number;
  totalNumbers: number;
  platformFeeRate: number;
  estimatedMpFeeRate: number;
}) {
  const desiredNetGoal = Math.max(0, toNumber(params.desiredNetGoal));
  const totalNumbers = Math.max(1, Math.trunc(toNumber(params.totalNumbers, 1)));
  const platformFeeRate = Math.max(0, toNumber(params.platformFeeRate));
  const estimatedMpFeeRate = Math.max(0, toNumber(params.estimatedMpFeeRate));

  const totalRate = platformFeeRate + estimatedMpFeeRate;
  const factor = 1 - totalRate;

  if (factor <= 0) {
    return {
      suggestedTicketPrice: 0,
      rawTicketPrice: 0,
      estimatedGrossGoal: 0,
      estimatedPlatformFeeAmount: 0,
      estimatedMpFeeAmount: 0,
      estimatedOrganizerNet: 0,
      totalRate,
    };
  }

  const rawTicketPrice = desiredNetGoal / totalNumbers / factor;
  const suggestedTicketPrice = Math.max(0, Math.ceil(rawTicketPrice));

  const estimatedGrossGoal = round2(suggestedTicketPrice * totalNumbers);
  const estimatedPlatformFeeAmount = round2(estimatedGrossGoal * platformFeeRate);
  const estimatedMpFeeAmount = round2(estimatedGrossGoal * estimatedMpFeeRate);
  const estimatedOrganizerNet = round2(
    estimatedGrossGoal - estimatedPlatformFeeAmount - estimatedMpFeeAmount,
  );

  return {
    suggestedTicketPrice,
    rawTicketPrice: round2(rawTicketPrice),
    estimatedGrossGoal,
    estimatedPlatformFeeAmount,
    estimatedMpFeeAmount,
    estimatedOrganizerNet,
    totalRate,
  };
}