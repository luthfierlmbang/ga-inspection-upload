const MAX_SIDE = 1600;
const QUALITY = 0.82;

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      // 'from-image' applies the EXIF orientation from phone cameras.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall back to <img>, which also honours EXIF in current browsers */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImage(file) {
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error('Format foto tidak bisa dibaca. Pakai JPEG atau PNG.');
  }
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(source, 0, 0, cw, ch);
  source.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Gagal mengompres foto');
  return { blob, width: cw, height: ch };
}
