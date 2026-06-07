import { isTerminalOrHonorIndex } from './tile';

const cloneCounts = (counts: number[]): number[] => [...counts];

const isSuitedSequenceStart = (index: number): boolean =>
  index < 27 && index % 9 <= 6;

const isSuitedNeighborStart = (index: number): boolean =>
  index < 27 && index % 9 <= 7;

const isSuitedGapStart = (index: number): boolean =>
  index < 27 && index % 9 <= 6;

export const standardShanten = (
  sourceCounts: number[],
  openMelds = 0
): number => {
  const counts = cloneCounts(sourceCounts);
  let best = 8;

  const dfs = (
    start: number,
    melds: number,
    taatsu: number,
    pair: 0 | 1
  ): void => {
    if (melds + openMelds > 4) return;

    let index = start;
    while (index < 34 && counts[index] === 0) index += 1;

    if (index >= 34) {
      const totalMelds = melds + openMelds;
      const usefulTaatsu = Math.min(taatsu, 4 - totalMelds);
      const shanten = 8 - totalMelds * 2 - usefulTaatsu - pair;
      if (shanten < best) best = shanten;
      return;
    }

    const optimistic = 8 - (melds + openMelds) * 2 - taatsu - pair;
    if (optimistic >= best + 3) return;

    if (counts[index] >= 3) {
      counts[index] -= 3;
      dfs(index, melds + 1, taatsu, pair);
      counts[index] += 3;
    }

    if (
      isSuitedSequenceStart(index) &&
      counts[index + 1] > 0 &&
      counts[index + 2] > 0
    ) {
      counts[index] -= 1;
      counts[index + 1] -= 1;
      counts[index + 2] -= 1;
      dfs(index, melds + 1, taatsu, pair);
      counts[index] += 1;
      counts[index + 1] += 1;
      counts[index + 2] += 1;
    }

    if (counts[index] >= 2) {
      if (pair === 0) {
        counts[index] -= 2;
        dfs(index, melds, taatsu, 1);
        counts[index] += 2;
      }
      counts[index] -= 2;
      dfs(index, melds, taatsu + 1, pair);
      counts[index] += 2;
    }

    if (isSuitedNeighborStart(index) && counts[index + 1] > 0) {
      counts[index] -= 1;
      counts[index + 1] -= 1;
      dfs(index, melds, taatsu + 1, pair);
      counts[index] += 1;
      counts[index + 1] += 1;
    }

    if (isSuitedGapStart(index) && counts[index + 2] > 0) {
      counts[index] -= 1;
      counts[index + 2] -= 1;
      dfs(index, melds, taatsu + 1, pair);
      counts[index] += 1;
      counts[index + 2] += 1;
    }

    counts[index] -= 1;
    dfs(index, melds, taatsu, pair);
    counts[index] += 1;
  };

  dfs(0, 0, 0, 0);
  return best;
};

export const chitoitsuShanten = (counts: number[]): number => {
  const pairs = counts.filter(count => count >= 2).length;
  const unique = counts.filter(count => count > 0).length;
  return 6 - pairs + Math.max(0, 7 - unique);
};

export const kokushiShanten = (counts: number[]): number => {
  let unique = 0;
  let hasPair = false;
  for (let index = 0; index < 34; index += 1) {
    if (!isTerminalOrHonorIndex(index)) continue;
    if (counts[index] > 0) unique += 1;
    if (counts[index] >= 2) hasPair = true;
  }
  return 13 - unique - (hasPair ? 1 : 0);
};

export const evaluateShanten = (
  counts: number[],
  openMelds = 0
): number => {
  const candidates = [standardShanten(counts, openMelds)];
  if (openMelds === 0) {
    candidates.push(chitoitsuShanten(counts), kokushiShanten(counts));
  }
  return Math.min(...candidates);
};

export interface EffectiveTile {
  index: number;
  remaining: number;
}

export const effectiveTiles = (
  handCounts: number[],
  visibleCounts: number[],
  openMelds = 0
): EffectiveTile[] => {
  const current = evaluateShanten(handCounts, openMelds);
  const out: EffectiveTile[] = [];
  for (let index = 0; index < 34; index += 1) {
    const remaining = 4 - handCounts[index] - visibleCounts[index];
    if (remaining <= 0 || handCounts[index] >= 4) continue;
    handCounts[index] += 1;
    const next = evaluateShanten(handCounts, openMelds);
    handCounts[index] -= 1;
    if (next < current) out.push({ index, remaining });
  }
  return out;
};
