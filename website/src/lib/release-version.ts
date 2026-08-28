export type ReleaseNoteMeta = {
  id: string;
  version: string;
  date: Date;
};

export function compareSemver(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.split(".").map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });

  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) {
      return da - db;
    }
  }
  return 0;
}

export function pickLatestReleaseNote<T extends ReleaseNoteMeta>(notes: T[]): T | undefined {
  return [...notes].sort((a, b) => {
    const byVersion = compareSemver(b.version, a.version);
    if (byVersion !== 0) {
      return byVersion;
    }
    const byDate = b.date.getTime() - a.date.getTime();
    if (byDate !== 0) {
      return byDate;
    }
    return b.id.localeCompare(a.id);
  })[0];
}
