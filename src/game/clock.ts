let override: number | null = null;

export const now = (): number => override ?? Date.now();

export function setNow(t: number | null): void {
  override = t;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(t: number = now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nextMidnight(t: number = now()): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}
