import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

/**
 * Upload an image buffer to Cloudinary using authenticated (private) delivery.
 *
 * @param {Buffer} buffer
 * @param {string} folder - Cloudinary folder path, e.g. `pill-plan/{medId}`
 * @returns {Promise<{publicId: string}>}
 */
export async function uploadImage(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', type: 'authenticated' },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({ publicId: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

/**
 * Generate a short-lived signed URL for a private Cloudinary image.
 * Signing is done locally using the API secret — no network call.
 *
 * @param {string} publicId
 * @returns {string}
 */
export function signImageUrl(publicId) {
  return cloudinary.url(publicId, {
    type:        'authenticated',
    sign_url:    true,
    secure:      true,
    expires_at:  Math.floor(Date.now() / 1000) + 4 * 3600, // 4-hour window
  });
}

/**
 * Permanently delete an image from Cloudinary.
 *
 * @param {string} publicId
 * @returns {Promise<void>}
 */
export async function destroyImage(publicId) {
  await cloudinary.uploader.destroy(publicId, { type: 'authenticated' });
}
