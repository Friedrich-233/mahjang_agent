export type Suit = 'm' | 'p' | 's' | 'z';
export type TileCode = `${number}${Suit}`;

const SUIT_OFFSET: Record<Suit, number> = {
  m: 0,
  p: 9,
  s: 18,
  z: 27
};

const SUIT_ORDER: Record<Suit, number> = {
  m: 0,
  p: 1,
  s: 2,
  z: 3
};

const HONOR_LABELS = ['東', '南', '西', '北', '白', '發', '中'];

export const isTileCode = (value: string): value is TileCode =>
  /^[0-9][mps]$/.test(value) || /^[1-7]z$/.test(value);

export const normalizeTile = (tile: TileCode): TileCode =>
  tile[0] === '0' ? (`5${tile[1]}` as TileCode) : tile;

export const tileIndex = (tile: TileCode): number => {
  const normalized = normalizeTile(tile);
  const n = Number(normalized[0]);
  const suit = normalized[1] as Suit;
  return SUIT_OFFSET[suit] + n - 1;
};

export const tileFromIndex = (index: number): TileCode => {
  if (index < 9) return `${index + 1}m` as TileCode;
  if (index < 18) return `${index - 8}p` as TileCode;
  if (index < 27) return `${index - 17}s` as TileCode;
  return `${index - 26}z` as TileCode;
};

export const tileSortValue = (tile: TileCode): number => {
  const suit = tile[1] as Suit;
  const redOffset = tile[0] === '0' ? 0.5 : 0;
  return SUIT_ORDER[suit] * 10 + Number(normalizeTile(tile)[0]) + redOffset;
};

export const sortTiles = (tiles: TileCode[]): TileCode[] =>
  [...tiles].sort((a, b) => tileSortValue(a) - tileSortValue(b));

export const tileLabel = (tile: TileCode): string => {
  const n = Number(tile[0]);
  const suit = tile[1] as Suit;
  if (suit === 'z') return HONOR_LABELS[n - 1] ?? tile;
  const suitLabel = suit === 'm' ? 'm' : suit === 'p' ? 'p' : 's';
  return `${n === 0 ? '赤5' : n}${suitLabel}`;
};

export const parseMpsz = (raw: string): TileCode[] => {
  const compact = raw.toLowerCase().replace(/[\s,，、/|]+/g, '');
  const tiles: TileCode[] = [];
  let digits = '';
  for (const char of compact) {
    if (/[0-9]/.test(char)) {
      digits += char;
      continue;
    }
    if (/[mpsz]/.test(char)) {
      for (const digit of digits) {
        const code = `${digit}${char}` as TileCode;
        if (isTileCode(code)) tiles.push(code);
      }
      digits = '';
    }
  }
  return tiles;
};

export const tilesToMpsz = (tiles: TileCode[]): string => {
  const groups: Record<Suit, string> = { m: '', p: '', s: '', z: '' };
  for (const tile of sortTiles(tiles)) {
    const suit = tile[1] as Suit;
    groups[suit] += tile[0];
  }
  return (['m', 'p', 's', 'z'] as const)
    .map(suit => (groups[suit] ? `${groups[suit]}${suit}` : ''))
    .join('');
};

export const countsFromTiles = (tiles: TileCode[]): number[] => {
  const counts = Array<number>(34).fill(0);
  for (const tile of tiles) counts[tileIndex(tile)] += 1;
  return counts;
};

export const removeOneTile = (
  tiles: TileCode[],
  target: TileCode
): TileCode[] => {
  const out = [...tiles];
  const exact = out.findIndex(tile => tile === target);
  const loose =
    exact >= 0
      ? exact
      : out.findIndex(tile => tileIndex(tile) === tileIndex(target));
  if (loose >= 0) out.splice(loose, 1);
  return out;
};

export const uniqueTiles = (tiles: TileCode[]): TileCode[] => {
  const seen = new Set<string>();
  const out: TileCode[] = [];
  for (const tile of sortTiles(tiles)) {
    const key = tile;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tile);
    }
  }
  return out;
};

export const nextDora = (indicator: TileCode): TileCode => {
  const tile = normalizeTile(indicator);
  const n = Number(tile[0]);
  const suit = tile[1] as Suit;
  if (suit !== 'z') return `${(n % 9) + 1}${suit}` as TileCode;
  if (n <= 4) return `${(n % 4) + 1}z` as TileCode;
  return `${n === 7 ? 5 : n + 1}z` as TileCode;
};

export const isTerminalOrHonorIndex = (index: number): boolean =>
  index >= 27 || index % 9 === 0 || index % 9 === 8;
