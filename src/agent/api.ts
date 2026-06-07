import type { DetectResponse } from './types';

const MAX_EDGE = 1500;
const JPEG_QUALITY = 0.86;

export const fileToResizedDataUrl = (
  file: File
): Promise<{ dataUrl: string; mediaType: string }> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const longEdge = Math.max(image.width, image.height) || 1;
      const scale = Math.min(1, MAX_EDGE / longEdge);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        reject(new Error('Canvas 2D context is unavailable.'));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
        mediaType: 'image/jpeg'
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load the selected image.'));
    };
    image.src = objectUrl;
  });

export const detectImage = async (file: File): Promise<DetectResponse> => {
  const { dataUrl, mediaType } = await fileToResizedDataUrl(file);
  const response = await fetch('/api/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, media_type: mediaType })
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Detection failed (HTTP ${response.status})`;
    throw new Error(error);
  }
  return data as DetectResponse;
};
