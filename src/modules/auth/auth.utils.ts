import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../../entities/user.entity';

export const normalizeEmail = (value: string) =>
  String(value ?? '').trim().toLowerCase();

export const normalizeName = (value: string) =>
  String(value ?? '').trim().replace(/\s+/g, ' ');

export const getPasswordChecks = (password: string) => {
  const safe = String(password ?? '');

  const minLength = safe.length >= 8;
  const uppercase = /[A-ZÁÉÍÓÚÑ]/.test(safe);
  const number = /\d/.test(safe);
  const lowercase = /[a-záéíóúñ]/.test(safe);
  const special = /[^A-Za-z0-9]/.test(safe);

  const score =
    Number(minLength) +
    Number(uppercase) +
    Number(number) +
    Number(lowercase) +
    Number(special);

  return {
    minLength,
    uppercase,
    number,
    lowercase,
    special,
    score,
    isStrong: minLength && uppercase && number,
  };
};

export const ensureStrongPassword = (password: string) => {
  const checks = getPasswordChecks(password);
  return checks.isStrong;
};

export const hashSecret = async (value: string) => bcrypt.hash(value, 10);

export const compareSecret = async (plain: string, hash: string | null | undefined) => {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
};

export const generateRecoveryCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const blocks = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => chars[crypto.randomInt(0, chars.length)]).join(''),
  );

  return blocks.join('-');
};

export const generateTemporaryPassword = () => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const nums = '23456789';
  const symbols = '!@#$%&*';
  const all = `${upper}${lower}${nums}${symbols}`;

  const parts = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    nums[crypto.randomInt(0, nums.length)],
    symbols[crypto.randomInt(0, symbols.length)],
  ];

  while (parts.length < 10) {
    parts.push(all[crypto.randomInt(0, all.length)]);
  }

  for (let i = parts.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return parts.join('');
};

export const sanitizeUser = (user: User | null | undefined) => {
  if (!user) return null;

  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`
    .replace(/\s+/g, ' ')
    .trim();

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  };
};