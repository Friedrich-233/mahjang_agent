import type { TileCode } from './tile';

export type Seat = 'self' | 'left' | 'across' | 'right';

export type Zone =
  | 'ownHand'
  | 'selfRiver'
  | 'leftRiver'
  | 'acrossRiver'
  | 'rightRiver'
  | 'possibleMeld'
  | 'unknown';

export interface Detection {
  tile: TileCode;
  confidence: number;
  className: string;
  classId: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

export interface DetectResponse {
  model: string;
  image: { width: number; height: number };
  detections: Detection[];
}

export interface ZonedDetection extends Detection {
  zone: Zone;
}

export interface MeldObservation {
  seat: Seat | 'unknown';
  type: 'chi' | 'pon' | 'kan' | 'unknown';
  tiles: TileCode[];
  confidence: number;
}

export interface AgentEvent {
  at: string;
  seat: Seat;
  tiles: TileCode[];
  text: string;
}

export interface AgentState {
  hand: TileCode[];
  rivers: Record<Seat, TileCode[]>;
  melds: MeldObservation[];
  events: AgentEvent[];
  doraIndicators: TileCode[];
  roundWind: 'east' | 'south' | 'west' | 'north';
  seatWind: 'east' | 'south' | 'west' | 'north';
  prompts: string[];
}

export interface DiscardAdvice {
  discard: TileCode;
  shanten: number;
  effectiveTiles: TileCode[];
  acceptance: number;
  doraPenalty: number;
  note: string;
}
