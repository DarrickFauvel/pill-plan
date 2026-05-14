import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

/**
 * Upload an image buffer to Cloudinary.
 *
 * @param {Buffer} buffer
 * @param {string} folder - Cloudinary folder path, e.g. `pill-plan/{medId}`
 * @returns {Promise<{publicId: string}>}
 */
export async function uploadImage(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({ publicId: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

/**
 * Return the HTTPS delivery URL for a Cloudinary image, optionally with a
 * non-destructive crop transformation applied.
 *
 * @param {string} publicId
 * @param {{ x: number, y: number, width: number, height: number } | null} [cropData]
 * @returns {string}
 */
export function imageUrl(publicId, cropData) {
  if (!cropData) return cloudinary.url(publicId, { secure: true });
  return cloudinary.url(publicId, {
    secure: true,
    transformation: [{
      crop: 'crop',
      gravity: 'north_west',
      x: Math.round(cropData.x),
      y: Math.round(cropData.y),
      width:  Math.round(cropData.width),
      height: Math.round(cropData.height),
    }],
  });
}

/** @deprecated use imageUrl */
export const signImageUrl = imageUrl;

/**
 * Permanently delete an image from Cloudinary.
 *
 * @param {string} publicId
 * @returns {Promise<void>}
 */
export async function destroyImage(publicId) {
  await cloudinary.uploader.destroy(publicId);
}
