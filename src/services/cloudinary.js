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
 * Return the HTTPS delivery URL for a Cloudinary image.
 *
 * @param {string} publicId
 * @returns {string}
 */
export function signImageUrl(publicId) {
  return cloudinary.url(publicId, { secure: true });
}

/**
 * Permanently delete an image from Cloudinary.
 *
 * @param {string} publicId
 * @returns {Promise<void>}
 */
export async function destroyImage(publicId) {
  await cloudinary.uploader.destroy(publicId);
}
