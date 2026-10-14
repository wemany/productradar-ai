import { API_LIMITS, checkPublicUrl } from '@productradar/core';

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1280;

export class ImageInputError extends Error {}

export interface PreparedImage {
  base64: string;
  mimeType: 'image/jpeg';
  previewUrl: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Valida y comprime la foto EN LA EXTENSIÓN antes de enviarla al proveedor de
 * visión: máx. 1280 px por lado, JPEG. Reencodificar en un canvas también
 * elimina metadatos EXIF (ubicación GPS, cámara).
 */
export async function prepareImage(blob: Blob): Promise<PreparedImage> {
  if (!ACCEPTED_IMAGE_TYPES.includes(blob.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    throw new ImageInputError('Formato no admitido. Usa PNG, JPG o WEBP.');
  }
  if (blob.size > MAX_INPUT_BYTES) throw new ImageInputError('La imagen supera 15 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new ImageInputError('No se pudo leer la imagen.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageInputError('El navegador no pudo procesar la imagen.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of [0.85, 0.75, 0.65, 0.55]) {
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const base64 = await blobToBase64(jpeg);
    if (base64.length <= API_LIMITS.maxImageBase64Length) {
      return { base64, mimeType: 'image/jpeg', previewUrl: URL.createObjectURL(jpeg), width, height, bytes: jpeg.size };
    }
  }
  throw new ImageInputError('La imagen sigue siendo demasiado grande tras comprimirla.');
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Descarga una imagen pública (requiere permiso del sitio de la imagen). */
export async function fetchImageBlob(url: string): Promise<Blob> {
  if (!checkPublicUrl(url).ok) throw new ImageInputError('Dirección de imagen no permitida.');
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new ImageInputError(`No se pudo descargar la imagen (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (blob.size > MAX_INPUT_BYTES) throw new ImageInputError('La imagen supera 15 MB.');
  return blob;
}
