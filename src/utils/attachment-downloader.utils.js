import axios from 'axios';
import crypto from 'crypto';
import { MULTIMEDIA_LIMITS } from '../constants/multimedia.constants.js';

/**
 * Utilidad para descargar attachments de Chatwoot
 */
class AttachmentDownloader {
    constructor() {
        this.downloadCache = new Map(); // Cache simple en memoria
    }

    /**
     * Descarga un attachment desde su URL
     * 
     * @param {string} url - URL del attachment (data_url o thumb_url)
     * @param {number} maxSizeMB - Tamaño máximo permitido en MB
     * @returns {Promise<Buffer>} - Buffer del archivo
     */
    async download(url, maxSizeMB = 25) {
        if (!url) {
            throw new Error('URL del attachment no proporcionada');
        }

        // Generar hash para caché
        const urlHash = crypto.createHash('md5').update(url).digest('hex');

        // Verificar caché
        if (this.downloadCache.has(urlHash)) {
            console.log(`📦 Usando attachment cacheado: ${urlHash.substring(0, 8)}`);
            return this.downloadCache.get(urlHash);
        }

        console.log(`⬇️  Descargando attachment: ${url.substring(0, 50)}...`);

        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: MULTIMEDIA_LIMITS.DOWNLOAD_TIMEOUT_MS,
                maxContentLength: maxSizeMB * 1024 * 1024,
                headers: {
                    'User-Agent': 'Chatwoot-ICC-App/2.0'
                }
            });

            const buffer = Buffer.from(response.data);

            // Verificar tamaño
            const sizeMB = buffer.length / (1024 * 1024);
            if (sizeMB > maxSizeMB) {
                throw new Error(`Archivo muy grande: ${sizeMB.toFixed(2)}MB (máximo: ${maxSizeMB}MB)`);
            }

            console.log(`✅ Attachment descargado: ${sizeMB.toFixed(2)}MB`);

            // Guardar en caché
            this.downloadCache.set(urlHash, buffer);

            // Limpiar caché después de 1 hora
            setTimeout(() => {
                this.downloadCache.delete(urlHash);
            }, 3600000); // 1 hora

            return buffer;

        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                throw new Error('Timeout descargando attachment');
            }
            if (error.response?.status === 404) {
                throw new Error('Attachment no encontrado (404)');
            }
            console.error('❌ Error descargando attachment:', error.message);
            throw new Error(`Error descargando attachment: ${error.message}`);
        }
    }

    /**
     * Convierte Buffer a base64
     * 
     * @param {Buffer} buffer - Buffer del archivo
     * @returns {string} - String base64
     */
    toBase64(buffer) {
        return buffer.toString('base64');
    }

    /**
     * Genera hash MD5 de un Buffer (para caché)
     * 
     * @param {Buffer} buffer - Buffer del archivo
     * @returns {string} - Hash MD5
     */
    getFileHash(buffer) {
        return crypto.createHash('md5').update(buffer).digest('hex');
    }

    /**
     * Limpia la caché manualmente
     */
    clearCache() {
        this.downloadCache.clear();
        console.log('🗑️  Caché de attachments limpiada');
    }

    /**
     * Obtiene estadísticas de la caché
     * 
     * @returns {Object} - Estadísticas
     */
    getCacheStats() {
        return {
            entries: this.downloadCache.size,
            maxEntries: MULTIMEDIA_LIMITS.MAX_IMAGES_PER_CONVERSATION + MULTIMEDIA_LIMITS.MAX_AUDIO_PER_CONVERSATION
        };
    }
}

export default new AttachmentDownloader();
