import { BadRequestException } from '@nestjs/common';
import { RaffleAccessPlan } from '../../common/enums/raffle-access-plan.enum';

export type RaffleAccessPlanConfig = {
  key: RaffleAccessPlan;
  maxNumbers: number;
  amount: number;
  label: string;
};

export const RAFFLE_ACCESS_PLANS: RaffleAccessPlanConfig[] = [
  {
    key: RaffleAccessPlan.UP_TO_100,
    maxNumbers: 100,
    amount: 1000,
    label: 'Hasta 100 números',
  },
  {
    key: RaffleAccessPlan.UP_TO_500,
    maxNumbers: 500,
    amount: 2000,
    label: 'Hasta 500 números',
  },
  {
    key: RaffleAccessPlan.UP_TO_1000,
    maxNumbers: 1000,
    amount: 5000,
    label: 'Hasta 1000 números',
  },
];

export function resolveRaffleAccessPlan(totalNumbers: number): RaffleAccessPlanConfig {
  const plan = RAFFLE_ACCESS_PLANS.find((item) => totalNumbers <= item.maxNumbers);

  if (!plan) {
    throw new BadRequestException(
      'No existe un plan configurado para rifas con esa cantidad de números',
    );
  }

  return plan;
}