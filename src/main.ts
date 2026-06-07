import './styles.css';
import { adviseDiscard } from './agent/advisor';
import { detectImage } from './agent/api';
import {
  initialAgentState,
  observeTable,
  scanOwnHand,
  visibleTiles
} from './agent/vision';
import {
  parseMpsz,
  sortTiles,
  tileLabel,
  tilesToMpsz,
  type TileCode
} from './agent/tile';
import type { AgentState, DetectResponse, Zone, ZonedDetection } from './agent/types';

type CaptureMode = 'hand' | 'table';

let agentState: AgentState = initialAgentState();
let lastResponse: DetectResponse | null = null;
let lastZoned: ZonedDetection[] = [];
let busy = false;
let errorMessage = '';
let cameraStream: MediaStream | null = null;

const app = document.querySelector<HTMLDivElement>('#app');
if (app === null) throw new Error('#app is missing');

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const renderTile = (tile: TileCode, strong = false): string =>
  `<span class="tile ${tile[0] === '0' ? 'red' : ''} ${strong ? 'strong' : ''}">${escapeHtml(tileLabel(tile))}</span>`;

const renderTiles = (tiles: TileCode[], empty = '无'): string =>
  tiles.length === 0
    ? `<span class="empty">${empty}</span>`
    : sortTiles(tiles).map(tile => renderTile(tile)).join('');

const zoneLabel = (zone: Zone): string => {
  switch (zone) {
    case 'ownHand':
      return '自己手牌区';
    case 'selfRiver':
      return '自己牌河';
    case 'leftRiver':
      return '左侧牌河';
    case 'acrossRiver':
      return '对家牌河';
    case 'rightRiver':
      return '右侧牌河';
    case 'possibleMeld':
      return '疑似副露区';
    case 'unknown':
      return '未知区';
  }
};

const windLabel = (wind: AgentState['roundWind']): string =>
  ({ east: '东', south: '南', west: '西', north: '北' })[wind];

const seatLabel = (seat: keyof AgentState['rivers']): string =>
  ({ self: '自己', left: '下家/左侧', across: '对家', right: '上家/右侧' })[
    seat
  ];

const allVisibleTiles = (): TileCode[] => visibleTiles(agentState);

const renderAdvice = (): string => {
  const advice = adviseDiscard({
    hand: agentState.hand,
    visibleTiles: allVisibleTiles(),
    doraIndicators: agentState.doraIndicators
  });

  const best = advice.best;
  const candidateRows = advice.candidates
    .slice(0, 8)
    .map(
      candidate => `
        <tr class="${best?.discard === candidate.discard ? 'selected' : ''}">
          <td>${renderTile(candidate.discard, best?.discard === candidate.discard)}</td>
          <td>${candidate.shanten < 0 ? '和了形' : candidate.shanten === 0 ? '听牌' : `${candidate.shanten} 向听`}</td>
          <td>${candidate.acceptance}</td>
          <td>${renderTiles(candidate.effectiveTiles, '无')}</td>
        </tr>`
    )
    .join('');

  return `
    <section class="panel advice">
      <div class="panel-title">出牌建议</div>
      <p class="${advice.status === 'ready' ? 'ok' : 'warn'}">${escapeHtml(advice.message)}</p>
      <p class="hint">算法说明：这一版采用 Akagi 分析器的核心思路：枚举每个可切牌，计算切后向听数和扣除已见牌后的进张枚数。尚未接入 Akagi 完整的对手风险/放铳率引擎。</p>
      <table>
        <thead>
          <tr><th>切牌</th><th>状态</th><th>进张枚数</th><th>进张牌</th></tr>
        </thead>
        <tbody>${candidateRows || '<tr><td colspan="4" class="empty">等待 14 张手牌</td></tr>'}</tbody>
      </table>
    </section>`;
};

const renderRivers = (): string =>
  (Object.keys(agentState.rivers) as Array<keyof AgentState['rivers']>)
    .map(
      seat => `
        <div class="river">
          <div class="river-head">
            <strong>${seatLabel(seat)}</strong>
            <span>${agentState.rivers[seat].length} 张</span>
          </div>
          <div class="tile-row">${renderTiles(agentState.rivers[seat])}</div>
        </div>`
    )
    .join('');

const renderDetectionSummary = (): string => {
  if (lastZoned.length === 0) {
    return '<p class="empty">还没有检测结果。</p>';
  }
  const grouped = lastZoned.reduce(
    (acc, detection) => {
      acc[detection.zone] = [...(acc[detection.zone] ?? []), detection.tile];
      return acc;
    },
    {} as Partial<Record<Zone, TileCode[]>>
  );
  return (Object.keys(grouped) as Zone[])
    .map(
      zone => `
        <div class="zone-line">
          <span>${zoneLabel(zone)}</span>
          <span>${renderTiles(grouped[zone] ?? [])}</span>
        </div>`
    )
    .join('');
};

const renderEvents = (): string =>
  agentState.events.length === 0
    ? '<p class="empty">还没有新增打牌事件。</p>'
    : agentState.events
        .slice(0, 12)
        .map(
          event => `
            <div class="event">
              <span>${escapeHtml(event.at)}</span>
              <span>${escapeHtml(event.text)}</span>
            </div>`
        )
        .join('');

const renderMelds = (): string =>
  agentState.melds.length === 0
    ? '<p class="empty">暂无疑似副露。</p>'
    : agentState.melds
        .map(
          meld => `
            <div class="meld">
              <span>${meld.type.toUpperCase()}</span>
              <span>${renderTiles(meld.tiles)}</span>
              <span>${Math.round(meld.confidence * 100)}%</span>
            </div>`
        )
        .join('');

const render = (): void => {
  const doraText = tilesToMpsz(agentState.doraIndicators);
  app.innerHTML = `
    <div class="shell">
      <header>
        <div>
          <p class="eyebrow">Riichi Vision Agent</p>
          <h1>现实日麻牌桌 Agent</h1>
        </div>
        <div class="server">
          ${lastResponse ? `YOLO: ${escapeHtml(lastResponse.model)}` : '等待检测'}
        </div>
      </header>

      <section class="toolbar panel">
        <div class="camera-box">
          <video id="camera" autoplay playsinline muted></video>
          <div class="camera-actions">
            <button id="start-camera">开启摄像头</button>
            <button id="capture-hand" ${busy ? 'disabled' : ''}>扫描我的手牌</button>
            <button id="capture-table" ${busy ? 'disabled' : ''}>观察牌桌</button>
          </div>
        </div>
        <div class="upload-box">
          <label>
            扫描手牌照片
            <input id="hand-file" type="file" accept="image/*" capture="environment" />
          </label>
          <label>
            观察牌桌照片
            <input id="table-file" type="file" accept="image/*" capture="environment" />
          </label>
          <div class="settings-row">
            <label>场风
              <select id="round-wind">
                ${(['east', 'south', 'west', 'north'] as const)
                  .map(
                    wind =>
                      `<option value="${wind}" ${agentState.roundWind === wind ? 'selected' : ''}>${windLabel(wind)}</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label>自风
              <select id="seat-wind">
                ${(['east', 'south', 'west', 'north'] as const)
                  .map(
                    wind =>
                      `<option value="${wind}" ${agentState.seatWind === wind ? 'selected' : ''}>${windLabel(wind)}</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label>宝牌指示牌 mpsz
              <input id="dora" type="text" value="${escapeHtml(doraText)}" placeholder="如 4m 7p 3z" />
            </label>
          </div>
          <button id="reset">重置本局记录</button>
        </div>
      </section>

      ${busy ? '<div class="status">正在调用 YOLO 检测...</div>' : ''}
      ${errorMessage ? `<div class="status error">${escapeHtml(errorMessage)}</div>` : ''}

      <section class="grid">
        <div class="stack">
          <section class="panel">
            <div class="panel-title">自己的手牌</div>
            <div class="tile-row large">${renderTiles(agentState.hand, '请先扫描手牌')}</div>
            <p class="mpsz">${escapeHtml(tilesToMpsz(agentState.hand)) || 'empty'}</p>
          </section>
          ${renderAdvice()}
          <section class="panel">
            <div class="panel-title">提示</div>
            ${agentState.prompts.map(prompt => `<p class="hint">${escapeHtml(prompt)}</p>`).join('')}
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="panel-title">牌河快照</div>
            ${renderRivers()}
          </section>
          <section class="panel">
            <div class="panel-title">疑似副露</div>
            ${renderMelds()}
          </section>
          <section class="panel">
            <div class="panel-title">新增事件</div>
            ${renderEvents()}
          </section>
          <section class="panel">
            <div class="panel-title">上一帧区域归类</div>
            ${renderDetectionSummary()}
          </section>
        </div>
      </section>
    </div>
  `;

  wireEvents();
  attachCamera();
};

const attachCamera = (): void => {
  const video = document.querySelector<HTMLVideoElement>('#camera');
  if (video !== null && cameraStream !== null && video.srcObject !== cameraStream) {
    video.srcObject = cameraStream;
  }
};

const handleDetection = async (file: File, mode: CaptureMode): Promise<void> => {
  busy = true;
  errorMessage = '';
  render();
  try {
    const response = await detectImage(file);
    lastResponse = response;
    const result =
      mode === 'hand'
        ? scanOwnHand(agentState, response.detections)
        : observeTable(agentState, response.detections);
    agentState = result.state;
    lastZoned = result.zoned;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    render();
  }
};

const fileFromCamera = async (): Promise<File | null> => {
  const video = document.querySelector<HTMLVideoElement>('#camera');
  if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
    errorMessage = '摄像头还没有画面。请先开启摄像头，或使用照片上传。';
    render();
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9)
  );
  if (blob === null) return null;
  return new File([blob], 'camera.jpg', { type: 'image/jpeg' });
};

const startCamera = async (): Promise<void> => {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    errorMessage = '';
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : '无法开启摄像头。可改用照片上传。';
  }
  render();
};

const updateSettingsFromInputs = (): void => {
  const dora = document.querySelector<HTMLInputElement>('#dora');
  const roundWind = document.querySelector<HTMLSelectElement>('#round-wind');
  const seatWind = document.querySelector<HTMLSelectElement>('#seat-wind');
  agentState = {
    ...agentState,
    doraIndicators: parseMpsz(dora?.value ?? ''),
    roundWind:
      (roundWind?.value as AgentState['roundWind'] | undefined) ??
      agentState.roundWind,
    seatWind:
      (seatWind?.value as AgentState['seatWind'] | undefined) ??
      agentState.seatWind
  };
};

const wireEvents = (): void => {
  document.querySelector('#start-camera')?.addEventListener('click', () => {
    void startCamera();
  });
  document.querySelector('#capture-hand')?.addEventListener('click', () => {
    void (async () => {
      const file = await fileFromCamera();
      if (file !== null) await handleDetection(file, 'hand');
    })();
  });
  document.querySelector('#capture-table')?.addEventListener('click', () => {
    void (async () => {
      const file = await fileFromCamera();
      if (file !== null) await handleDetection(file, 'table');
    })();
  });
  document.querySelector<HTMLInputElement>('#hand-file')?.addEventListener('change', event => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void handleDetection(file, 'hand');
  });
  document.querySelector<HTMLInputElement>('#table-file')?.addEventListener('change', event => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void handleDetection(file, 'table');
  });
  for (const selector of ['#dora', '#round-wind', '#seat-wind']) {
    document.querySelector(selector)?.addEventListener('change', () => {
      updateSettingsFromInputs();
      render();
    });
  }
  document.querySelector('#reset')?.addEventListener('click', () => {
    agentState = initialAgentState();
    lastResponse = null;
    lastZoned = [];
    errorMessage = '';
    render();
  });
};

render();
