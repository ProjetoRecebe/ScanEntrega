import { MAX_BRIGHTNESS, MIN_BRIGHTNESS } from "./config.js";

/**
 * Calculates mean Rec. 601 luminance from RGBA pixel data.
 * @param {ArrayLike<number>} rgba
 * @returns {number}
 */
export function averageLuminance(rgba) {
  if (rgba.length === 0 || rgba.length % 4 !== 0) {
    throw new RangeError("Os pixels precisam conter dados RGBA completos.");
  }

  let total = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    total += 0.299 * rgba[index] + 0.587 * rgba[index + 1] + 0.114 * rgba[index + 2];
  }
  return total / (rgba.length / 4);
}

/**
 * Evaluates brightness and returns a user-facing reason when rejected.
 * @param {number} brightness
 * @returns {{ accepted: boolean, brightness: number, reason: string | null }}
 */
export function evaluateBrightness(brightness) {
  if (!Number.isFinite(brightness) || brightness < 0 || brightness > 255) {
    throw new RangeError("A luminosidade precisa estar entre 0 e 255.");
  }
  if (brightness < MIN_BRIGHTNESS) {
    return { accepted: false, brightness, reason: "muito escura" };
  }
  if (brightness > MAX_BRIGHTNESS) {
    return { accepted: false, brightness, reason: "estourada" };
  }
  return { accepted: true, brightness, reason: null };
}

/**
 * Reduces an image to a small canvas before checking its average brightness.
 * @param {Blob} blob
 * @returns {Promise<ReturnType<typeof evaluateBrightness>>}
 */
export async function assessImage(blob) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Não foi possível preparar a análise da foto.");

  let bitmap;
  let imageUrl;
  try {
    if ("createImageBitmap" in window) {
      bitmap = await createImageBitmap(blob);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } else {
      imageUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return evaluateBrightness(averageLuminance(pixels));
  } finally {
    bitmap?.close();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }
}
