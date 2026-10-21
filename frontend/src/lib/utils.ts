/**
 * Formatting and utility helpers for PoissonBurst Lab.
 */

export function formatProbability(p: number): string {
  if (p === 0) return '0.0';
  if (p === 1) return '1.0';
  if (p < 0.0001) {
    return p.toExponential(4);
  }
  return p.toFixed(5);
}

export function formatNumber(n: number, decimals: number = 2): string {
  return Number(n).toFixed(decimals);
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
