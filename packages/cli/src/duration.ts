type UpdateIntervalUnit = 'm' | 'h' | 'd';

const updateIntervalUnitMs: Record<UpdateIntervalUnit, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

const isUpdateIntervalUnit = (value: string | undefined): value is UpdateIntervalUnit => {
  return value === 'm' || value === 'h' || value === 'd';
};

export const parseUpdateIntervalMs = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const match = /^(?<amount>\d+(?:\.\d+)?)(?<unit>[mhd])$/u.exec(value);
  if (!match?.groups) {
    throw new Error(
      'Invalid --update-interval. Expected a number followed by m, h, or d, for example: --update-interval 30m.',
    );
  }

  const amount = Number(match.groups['amount']);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      'Invalid --update-interval. Expected a positive duration, for example: --update-interval 1h.',
    );
  }

  const unit = match.groups['unit'];
  if (!isUpdateIntervalUnit(unit)) {
    throw new Error(
      'Invalid --update-interval. Expected a number followed by m, h, or d, for example: --update-interval 30m.',
    );
  }
  const unitMs = updateIntervalUnitMs[unit];

  const intervalMs = amount * unitMs;
  if (intervalMs < 60 * 1000) {
    throw new Error('Invalid --update-interval. Minimum interval is 1m.');
  }

  return intervalMs;
};
