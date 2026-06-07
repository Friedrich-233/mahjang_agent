import {
  countsFromTiles,
  nextDora,
  removeOneTile,
  tileFromIndex,
  tileIndex,
  type TileCode,
  uniqueTiles
} from './tile';
import type { DiscardAdvice } from './types';
import { effectiveTiles, evaluateShanten } from './shanten';

export interface AdviceInput {
  hand: TileCode[];
  visibleTiles: TileCode[];
  doraIndicators: TileCode[];
}

export interface AdviceResult {
  status: 'ready' | 'need-draw' | 'need-hand' | 'invalid';
  message: string;
  best: DiscardAdvice | null;
  candidates: DiscardAdvice[];
}

const tileSetFromIndicators = (indicators: TileCode[]): Set<number> =>
  new Set(indicators.map(nextDora).map(tileIndex));

const describeShanten = (shanten: number): string => {
  if (shanten < 0) return '和了形';
  if (shanten === 0) return '听牌';
  return `${shanten} 向听`;
};

export const adviseDiscard = ({
  hand,
  visibleTiles,
  doraIndicators
}: AdviceInput): AdviceResult => {
  if (hand.length === 0) {
    return {
      status: 'need-hand',
      message: '先扫描自己的手牌。',
      best: null,
      candidates: []
    };
  }

  if (hand.length % 3 !== 2) {
    return {
      status: 'need-draw',
      message: `当前手牌是 ${hand.length} 张。出牌建议需要摸牌后的 14 张状态；请摸牌后重新扫描手牌。`,
      best: null,
      candidates: []
    };
  }

  if (hand.length > 14) {
    return {
      status: 'invalid',
      message: `检测到 ${hand.length} 张手牌，超过 14 张。请重新拍摄或降低误检。`,
      best: null,
      candidates: []
    };
  }

  const doraTiles = tileSetFromIndicators(doraIndicators);
  const visibleCounts = countsFromTiles([...visibleTiles, ...doraIndicators]);
  const candidates = uniqueTiles(hand).map(discard => {
    const nextHand = removeOneTile(hand, discard);
    const handCounts = countsFromTiles(nextHand);
    const shanten = evaluateShanten(handCounts);
    const effective = effectiveTiles(handCounts, visibleCounts);
    const acceptance = effective.reduce((sum, tile) => sum + tile.remaining, 0);
    const doraPenalty =
      doraTiles.has(tileIndex(discard)) || discard[0] === '0' ? 1 : 0;
    const effectiveTileCodes = effective.map(tile => tileFromIndex(tile.index));
    return {
      discard,
      shanten,
      effectiveTiles: effectiveTileCodes,
      acceptance,
      doraPenalty,
      note: `${describeShanten(shanten)} / ${acceptance} 枚进张`
    };
  });

  candidates.sort(
    (a, b) =>
      a.shanten - b.shanten ||
      b.acceptance - a.acceptance ||
      a.doraPenalty - b.doraPenalty ||
      tileIndex(a.discard) - tileIndex(b.discard)
  );

  const best = candidates[0] ?? null;
  return {
    status: 'ready',
    message:
      best === null
        ? '没有可用建议。'
        : `建议打 ${best.discard}: ${best.note}${best.doraPenalty ? '，但这是宝牌/赤牌候选，需人工确认价值。' : ''}`,
    best,
    candidates
  };
};
