import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const {
  APP_PORT,
  PORT,
  DIST_DIR,
  ROBOFLOW_API_KEY,
  ROBOFLOW_BASE_URL,
  ROBOFLOW_MODEL,
  ROBOFLOW_CONFIDENCE,
  ROBOFLOW_OVERLAP,
  ROBOFLOW_DEDUP_IOU,
  ROBOFLOW_CLASS_MAP
} = process.env;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(APP_PORT ?? PORT) || 5174;
const distDir = DIST_DIR || path.resolve(__dirname, '..', 'dist');
const roboflowBaseUrl =
  ROBOFLOW_BASE_URL?.replace(/\/+$/, '') || 'https://serverless.roboflow.com';

interface RoboflowPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
  class_id: number | null;
}

interface DetectedTile extends RoboflowPrediction {
  tile: string;
}

const MODEL_ALIASES: Record<string, string> = {
  'mahjong-9xjry/1': 'mahjong-9xjry-fvhg7/1'
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const modelFromUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname.includes('universe.roboflow.com')) {
      const modelIndex = parts.indexOf('model');
      const project = modelIndex > 0 ? parts[modelIndex - 1] : '';
      const version = modelIndex >= 0 ? parts[modelIndex + 1] : '';
      return project && version ? `${project}/${version}` : null;
    }
    if (url.hostname.includes('serverless.roboflow.com')) {
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
    }
  } catch {
    return null;
  }
  return null;
};

const normalizeModelId = (value: string | undefined): string =>
  (value ? modelFromUrl(value) || value : 'mahjong-9xjry-fvhg7/1')
    .trim()
    .replace(/^\/+/, '');

const configuredModel = normalizeModelId(ROBOFLOW_MODEL);
const roboflowModel = MODEL_ALIASES[configuredModel] ?? configuredModel;

const parseNumber = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const roboflowConfidence = clamp(
  Math.round(parseNumber(ROBOFLOW_CONFIDENCE, 30)),
  0,
  100
);
const roboflowOverlap = clamp(
  Math.round(parseNumber(ROBOFLOW_OVERLAP, 30)),
  0,
  100
);
const dedupeIou = clamp(parseNumber(ROBOFLOW_DEDUP_IOU, 0.55), 0, 1);

const numberValue = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const predictionFromUnknown = (value: unknown): RoboflowPrediction | null => {
  if (!isRecord(value)) return null;
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const width = numberValue(value.width);
  const height = numberValue(value.height);
  const confidence = numberValue(value.confidence);
  const classId = numberValue(value.class_id);
  const className = value.class;
  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    confidence === null ||
    typeof className !== 'string'
  ) {
    return null;
  }
  return {
    x,
    y,
    width,
    height,
    confidence,
    class: className,
    class_id: classId
  };
};

const dataUrlToBase64 = (image: string): string =>
  image
    .replace(/^data:[^,]*,/, '')
    .replace(/\s/g, '')
    .trim();

const roboflowEndpoint = (): string => {
  const url = new URL(`${roboflowBaseUrl}/${roboflowModel}`);
  url.searchParams.set('api_key', ROBOFLOW_API_KEY ?? '');
  url.searchParams.set('confidence', String(roboflowConfidence));
  url.searchParams.set('overlap', String(roboflowOverlap));
  url.searchParams.set('format', 'json');
  return url.toString();
};

const isValidMpszTile = (tile: string): boolean =>
  /^[0-9][mps]$/.test(tile) || /^[1-7]z$/.test(tile);

const parseClassMap = (raw: string | undefined): Record<string, string> => {
  if (!raw?.trim()) return {};
  const trimmed = raw.trim();
  const entries: Array<[string, string]> = [];

  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') entries.push([key, value]);
      }
    }
  } catch {
    for (const item of trimmed.split(',')) {
      const [key, value] = item.split(/[:=]/).map(part => part.trim());
      if (key && value) entries.push([key, value]);
    }
  }

  return Object.fromEntries(
    entries
      .map(([key, value]) => [key, value.toLowerCase()] as const)
      .filter(([, value]) => isValidMpszTile(value))
  );
};

const customClassMap = parseClassMap(ROBOFLOW_CLASS_MAP);

const normalizeClassName = (className: string): string => {
  const compact = className
    .toLowerCase()
    .replace(/mahjong/g, '')
    .replace(/riichi/g, '')
    .replace(/tiles?/g, '')
    .replace(/[\s_.-]+/g, '');

  const honorByName: Array<[RegExp, string]> = [
    [/(east|ton|dong)/, '1z'],
    [/(south|nan)/, '2z'],
    [/(west|shaa|sha|xi)/, '3z'],
    [/(north|pei|bei)/, '4z'],
    [/(white|haku|bai)/, '5z'],
    [/(green|hatsu|fa)/, '6z'],
    [/(chun|red.*dragon|hongzhong|zhong)/, '7z']
  ];
  for (const [pattern, tile] of honorByName) {
    if (pattern.test(compact)) return tile;
  }

  let match = compact.match(/^([mps])([0-9])$/);
  if (match?.[1] && match?.[2]) return `${match[2]}${match[1]}`;

  match = compact.match(/^([mps])([0-9])/);
  if (match?.[1] && match?.[2]) {
    const digit =
      match[2] === '5' && /(aka|red)/.test(compact) ? '0' : match[2];
    return `${digit}${match[1]}`;
  }

  match = compact.match(/^z([1-7])$/);
  if (match?.[1]) return `${match[1]}z`;

  match = compact.match(/^z([1-7])/);
  if (match?.[1]) return `${match[1]}z`;

  match = compact.match(/^([0-9])([mpsz])$/);
  if (match?.[1] && match?.[2]) return `${match[1]}${match[2]}`;

  match = compact.match(/^([0-9])([mps])/);
  if (match?.[1] && match?.[2]) {
    const digit =
      match[1] === '5' && /(aka|red)/.test(compact) ? '0' : match[1];
    return `${digit}${match[2]}`;
  }

  const number = compact.match(/[0-9]/)?.[0] ?? '';
  const suit = /(?:man|manzu|character|characters|wan|wanzu)/.test(compact)
    ? 'm'
    : /(?:pin|pinzu|circle|circles|dot|dots|tong)/.test(compact)
      ? 'p'
      : /(?:sou|souzu|bamboo|bam|suo)/.test(compact)
        ? 's'
        : '';

  if (number && suit) {
    const digit = number === '5' && /(aka|red)/.test(compact) ? '0' : number;
    return `${digit}${suit}`;
  }

  return '';
};

const tileFromPrediction = (prediction: RoboflowPrediction): string => {
  const classKey = prediction.class.trim();
  const classIdKey =
    prediction.class_id === null ? '' : String(prediction.class_id);
  const mapped = customClassMap[classKey] ?? customClassMap[classIdKey] ?? '';
  return mapped || normalizeClassName(prediction.class);
};

const iou = (a: RoboflowPrediction, b: RoboflowPrediction): number => {
  const ax1 = a.x - a.width / 2;
  const ay1 = a.y - a.height / 2;
  const ax2 = a.x + a.width / 2;
  const ay2 = a.y + a.height / 2;
  const bx1 = b.x - b.width / 2;
  const by1 = b.y - b.height / 2;
  const bx2 = b.x + b.width / 2;
  const by2 = b.y + b.height / 2;
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const intersection = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
};

const dedupePredictions = (
  predictions: RoboflowPrediction[]
): RoboflowPrediction[] => {
  const kept: RoboflowPrediction[] = [];
  for (const candidate of [...predictions].sort(
    (a, b) => b.confidence - a.confidence
  )) {
    if (kept.every(existing => iou(candidate, existing) < dedupeIou)) {
      kept.push(candidate);
    }
  }
  return kept;
};

const imageSizeFromRoboflow = (
  data: unknown,
  detected: DetectedTile[]
): { width: number; height: number } => {
  if (isRecord(data) && isRecord(data.image)) {
    const width = numberValue(data.image.width);
    const height = numberValue(data.image.height);
    if (width !== null && height !== null && width > 0 && height > 0) {
      return { width, height };
    }
  }
  return {
    width: Math.max(...detected.map(t => t.x + t.width / 2), 1),
    height: Math.max(...detected.map(t => t.y + t.height / 2), 1)
  };
};

const detectionsFromRoboflow = (data: unknown) => {
  const predictions =
    isRecord(data) && Array.isArray(data.predictions) ? data.predictions : [];
  const parsed = predictions
    .map(predictionFromUnknown)
    .filter((p): p is RoboflowPrediction => p !== null);
  const deduped = dedupePredictions(parsed);
  const detected = deduped
    .map(prediction => ({ ...prediction, tile: tileFromPrediction(prediction) }))
    .filter((prediction): prediction is DetectedTile =>
      isValidMpszTile(prediction.tile)
    )
    .sort((a, b) => (Math.abs(a.y - b.y) > 16 ? a.y - b.y : a.x - b.x));

  if (detected.length === 0) {
    throw new Error('Roboflow did not return any mahjong tile predictions');
  }

  const image = imageSizeFromRoboflow(data, detected);
  return {
    model: roboflowModel,
    image,
    detections: detected.map(prediction => ({
      tile: prediction.tile,
      confidence: prediction.confidence,
      className: prediction.class,
      classId: prediction.class_id,
      x: prediction.x,
      y: prediction.y,
      width: prediction.width,
      height: prediction.height,
      nx: prediction.x / image.width,
      ny: prediction.y / image.height,
      nw: prediction.width / image.width,
      nh: prediction.height / image.height
    }))
  };
};

const callRoboflow = async (base64Image: string): Promise<unknown> => {
  if (!ROBOFLOW_API_KEY) {
    throw new Error('ROBOFLOW_API_KEY is not set on the server');
  }

  const response = await fetch(roboflowEndpoint(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: base64Image
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      isRecord(data) && typeof data.error === 'string' ? data.error : text;
    throw new Error(message || `Roboflow request failed (${response.status})`);
  }
  return data;
};

const app = express();
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(ROBOFLOW_API_KEY),
    provider: 'roboflow',
    model: roboflowModel,
    configuredModel,
    modelAliasApplied: configuredModel !== roboflowModel,
    confidence: roboflowConfidence,
    overlap: roboflowOverlap,
    dedupeIou,
    baseUrl: roboflowBaseUrl
  });
});

app.post('/api/detect', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { image?: unknown };
    const image = typeof body.image === 'string' ? body.image : '';
    const base64Image = dataUrlToBase64(image);
    if (!base64Image) {
      res.status(400).json({ error: 'No image provided.' });
      return;
    }
    const roboflowResult = await callRoboflow(base64Image);
    res.json(detectionsFromRoboflow(roboflowResult));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[detect] failed:', message);
    res.status(502).json({ error: message });
  }
});

app.use(express.static(distDir));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`riichi-vision-agent listening on http://0.0.0.0:${port}`);
  console.log(`  static: ${distDir}`);
  console.log(`  Roboflow model: ${roboflowModel}`);
  if (configuredModel !== roboflowModel) {
    console.log(`  configured model: ${configuredModel}`);
  }
  console.log(
    `  confidence=${roboflowConfidence}, overlap=${roboflowOverlap}, dedupe_iou=${dedupeIou}`
  );
  if (!ROBOFLOW_API_KEY) {
    console.warn('  WARNING: ROBOFLOW_API_KEY is not set; /api/detect fails.');
  }
});
