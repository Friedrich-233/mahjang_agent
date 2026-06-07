import {
  sortTiles,
  tileIndex,
  tileSortValue,
  tilesToMpsz,
  type TileCode
} from './tile';
import type {
  AgentEvent,
  AgentState,
  Detection,
  MeldObservation,
  Seat,
  Zone,
  ZonedDetection
} from './types';

const RIVER_ZONE_TO_SEAT: Partial<Record<Zone, Seat>> = {
  selfRiver: 'self',
  leftRiver: 'left',
  acrossRiver: 'across',
  rightRiver: 'right'
};

const riverZones = [
  'selfRiver',
  'leftRiver',
  'acrossRiver',
  'rightRiver'
] as const;

export const initialAgentState = (): AgentState => ({
  hand: [],
  rivers: {
    self: [],
    left: [],
    across: [],
    right: []
  },
  melds: [],
  events: [],
  doraIndicators: [],
  roundWind: 'east',
  seatWind: 'east',
  prompts: [
    '开局先用“扫描我的手牌”。观察牌桌时请让自己的牌河在画面下方，对家在上方。'
  ]
});

export const zoneForDetection = (detection: Detection): Zone => {
  const { nx, ny } = detection;
  if (ny >= 0.78 && nx >= 0.08 && nx <= 0.92) return 'ownHand';
  if (ny >= 0.55 && ny < 0.78 && nx >= 0.26 && nx <= 0.74) {
    return 'selfRiver';
  }
  if (ny >= 0.08 && ny < 0.38 && nx >= 0.25 && nx <= 0.75) {
    return 'acrossRiver';
  }
  if (nx < 0.36 && ny >= 0.22 && ny <= 0.72) return 'leftRiver';
  if (nx > 0.64 && ny >= 0.22 && ny <= 0.72) return 'rightRiver';
  if (nx < 0.18 || nx > 0.82 || ny < 0.16 || ny > 0.84) {
    return 'possibleMeld';
  }
  return 'unknown';
};

export const zoneDetections = (detections: Detection[]): ZonedDetection[] =>
  detections
    .map(detection => ({
      ...detection,
      zone: zoneForDetection(detection)
    }))
    .sort((a, b) => (Math.abs(a.ny - b.ny) > 0.05 ? a.ny - b.ny : a.nx - b.nx));

const compactTiles = (tiles: TileCode[]): string =>
  tiles.length > 0 ? tilesToMpsz(tiles) : '无';

const diffTiles = (previous: TileCode[], next: TileCode[]): TileCode[] => {
  const remaining = new Map<number, number>();
  for (const tile of previous) {
    const index = tileIndex(tile);
    remaining.set(index, (remaining.get(index) ?? 0) + 1);
  }

  const added: TileCode[] = [];
  for (const tile of next) {
    const index = tileIndex(tile);
    const count = remaining.get(index) ?? 0;
    if (count > 0) {
      remaining.set(index, count - 1);
    } else {
      added.push(tile);
    }
  }
  return added;
};

const seatLabel = (seat: Seat): string =>
  seat === 'self'
    ? '自己'
    : seat === 'left'
      ? '下家/左侧'
      : seat === 'across'
        ? '对家'
        : '上家/右侧';

const classifyMeld = (tiles: TileCode[]): MeldObservation['type'] => {
  if (tiles.length === 4 && tiles.every(tile => tileIndex(tile) === tileIndex(tiles[0] as TileCode))) {
    return 'kan';
  }
  if (tiles.length === 3 && tiles.every(tile => tileIndex(tile) === tileIndex(tiles[0] as TileCode))) {
    return 'pon';
  }
  if (tiles.length === 3) {
    const normalized = [...tiles].sort((a, b) => tileSortValue(a) - tileSortValue(b));
    const suits = new Set(normalized.map(tile => tile[1]));
    const nums = normalized.map(tile => Number(tile[0] === '0' ? '5' : tile[0]));
    if (
      suits.size === 1 &&
      normalized[0]?.[1] !== 'z' &&
      nums[1] === nums[0] + 1 &&
      nums[2] === nums[1] + 1
    ) {
      return 'chi';
    }
  }
  return 'unknown';
};

const sideFromDetection = (detection: ZonedDetection): Seat | 'unknown' => {
  if (detection.nx < 0.33) return 'left';
  if (detection.nx > 0.67) return 'right';
  if (detection.ny < 0.35) return 'across';
  return 'unknown';
};

export const findPossibleMelds = (
  detections: ZonedDetection[]
): MeldObservation[] => {
  const candidates = detections
    .filter(detection => detection.zone === 'possibleMeld')
    .sort((a, b) => a.ny - b.ny || a.nx - b.nx);
  const groups: ZonedDetection[][] = [];

  for (const detection of candidates) {
    const group = groups.find(existing => {
      const first = existing[0];
      if (first === undefined) return false;
      return (
        sideFromDetection(first) === sideFromDetection(detection) &&
        Math.abs(first.ny - detection.ny) < 0.08
      );
    });
    if (group) group.push(detection);
    else groups.push([detection]);
  }

  return groups
    .filter(group => group.length === 3 || group.length === 4)
    .map(group => {
      const tiles = sortTiles(group.map(detection => detection.tile));
      return {
        seat: sideFromDetection(group[0] as ZonedDetection),
        type: classifyMeld(tiles),
        tiles,
        confidence:
          group.reduce((sum, detection) => sum + detection.confidence, 0) /
          group.length
      };
    });
};

export const scanOwnHand = (
  state: AgentState,
  detections: Detection[]
): { state: AgentState; zoned: ZonedDetection[] } => {
  const sorted = [...detections].sort((a, b) =>
    Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x
  );
  const hand = sorted.map(detection => detection.tile);
  const prompts = [
    hand.length === 13 || hand.length === 14
      ? `已记录自己的手牌: ${compactTiles(hand)}。`
      : `检测到 ${hand.length} 张手牌。理想是 13 或 14 张；请检查是否漏拍/误检。`
  ];

  return {
    state: {
      ...state,
      hand,
      prompts
    },
    zoned: sorted.map(detection => ({ ...detection, zone: 'ownHand' }))
  };
};

export const observeTable = (
  state: AgentState,
  detections: Detection[]
): { state: AgentState; zoned: ZonedDetection[] } => {
  const zoned = zoneDetections(detections);
  const nextRivers = { ...state.rivers };
  const events: AgentEvent[] = [];
  const prompts: string[] = [];

  for (const zone of riverZones) {
    const seat = RIVER_ZONE_TO_SEAT[zone] as Seat;
    const tiles = zoned
      .filter(detection => detection.zone === zone)
      .sort((a, b) =>
        Math.abs(a.ny - b.ny) > 0.05 ? a.ny - b.ny : a.nx - b.nx
      )
      .map(detection => detection.tile);
    const added = diffTiles(state.rivers[seat], tiles);
    if (added.length > 0) {
      events.push({
        at: new Date().toLocaleTimeString(),
        seat,
        tiles: added,
        text: `${seatLabel(seat)} 新增打牌: ${compactTiles(added)}`
      });
    }
    nextRivers[seat] = tiles;
  }

  const melds = findPossibleMelds(zoned);
  if (melds.length > 0) {
    prompts.push(
      `画面边缘检测到 ${melds.length} 组疑似副露。请确认是否有人吃/碰/杠。`
    );
  }

  const unknownCount = zoned.filter(detection => detection.zone === 'unknown').length;
  if (unknownCount > Math.max(2, zoned.length * 0.25)) {
    prompts.push(
      '未知区域的牌较多。请把摄像头移到牌桌正上方，让四家牌河分别落在下/左/上/右区域。'
    );
  }

  if (zoned.length < 6) {
    prompts.push('本帧看到的牌很少。如果是在观察牌河，请靠近牌桌或提高光线。');
  }

  if (events.length === 0 && prompts.length === 0) {
    prompts.push('本帧没有发现新的打牌；牌河快照已刷新。');
  }

  return {
    state: {
      ...state,
      rivers: nextRivers,
      melds,
      events: [...events, ...state.events].slice(0, 40),
      prompts
    },
    zoned
  };
};

export const visibleTiles = (state: AgentState): TileCode[] => [
  ...Object.values(state.rivers).flat(),
  ...state.melds.flatMap(meld => meld.tiles)
];
