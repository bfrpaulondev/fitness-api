// src/plugins/cloudinary.js
const fp = require('fastify-plugin');
const { v2: cloudinary } = require('cloudinary');

module.exports = fp(async function (fastify) {
  const {
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
    CLOUDINARY_FOLDER = 'fitness-media'
  } = process.env;

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    fastify.log.warn('⚠️ Cloudinary: variáveis de ambiente ausentes. Upload irá falhar.');
  } else {
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
      secure: true
    });
    fastify.log.info('☁️  Cloudinary configurado');
  }

  // helper: faz upload a partir de um stream (fastify-multipart -> .file)
  fastify.decorate('cloudinaryUpload', (inputStream, options = {}) =>
    new Promise((resolve, reject) => {
      const uploader = cloudinary.uploader.upload_stream(
        { resource_type: 'auto', folder: CLOUDINARY_FOLDER, ...options },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      inputStream.pipe(uploader);
    })
  );

  fastify.decorate('cloudinary', cloudinary);
  fastify.decorate('cloudinaryFolder', CLOUDINARY_FOLDER);
});
