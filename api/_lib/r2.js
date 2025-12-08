import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getMaxBundleBytes } from './bundle-config.js';

const clients = new Map();

const makeClient = (forcePathStyle) => {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT_URL;
  const bucket = process.env.R2_BUCKET;

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error(
      'Missing R2 configuration. Ensure R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL, and R2_BUCKET are set.'
    );
  }

  const url = new URL(endpoint);
  // If endpoint already carries the bucket in the path, strip it to avoid double-including
  const pathParts = url.pathname.split('/').filter(Boolean);
  if (pathParts.length > 0 && pathParts[pathParts.length - 1] === bucket) {
    url.pathname = `/${pathParts.slice(0, -1).join('/')}`;
  }

  const cacheKey = `${forcePathStyle ? 'path' : 'virtual'}|${url.toString()}`;
  if (clients.has(cacheKey)) return clients.get(cacheKey);

  const client = new S3Client({
    region: 'auto',
    endpoint: url.toString(),
    forcePathStyle,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  clients.set(cacheKey, client);
  return client;
};

const streamToBuffer = async (stream, maxBytes) => {
  const chunks = [];
  let total = 0;

  for await (const chunk of stream) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      const error = new Error('Requested object exceeds size limits');
      error.status = 413;
      throw error;
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
};

export const fetchR2Object = async (key) => {
  const maxBytes = getMaxBundleBytes();

  const styles =
    process.env.R2_ADDRESSING_STYLE === 'virtual'
      ? [false]
      : process.env.R2_ADDRESSING_STYLE === 'path'
      ? [true]
      : [true, false]; // try path then virtual

  let lastError;
  for (const forcePathStyle of styles) {
    try {
      const s3 = makeClient(forcePathStyle);
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
        })
      );

      const contentLength = Number(response.ContentLength || 0);
      if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
        const error = new Error('Requested object exceeds size limits');
        error.status = 413;
        throw error;
      }

      const bodyBuffer = await streamToBuffer(response.Body, maxBytes);

      return {
        status: 200,
        buffer: bodyBuffer,
        contentLength: bodyBuffer.length,
        contentType: response.ContentType || 'application/octet-stream',
      };
    } catch (error) {
      lastError = error;
      const status = error?.$metadata?.httpStatusCode || error.status;
      if (status === 404) return { status: 404 };
      continue;
    }
  }

  throw lastError;
};

export const listR2Prefixes = async (prefix) => {
  const styles =
    process.env.R2_ADDRESSING_STYLE === 'virtual'
      ? [false]
      : process.env.R2_ADDRESSING_STYLE === 'path'
      ? [true]
      : [true, false]; // try path then virtual

  let lastError;
  for (const forcePathStyle of styles) {
    try {
      const s3 = makeClient(forcePathStyle);
      const response = await s3.send(
        new ListObjectsV2Command({
          Bucket: process.env.R2_BUCKET,
          Prefix: prefix,
          Delimiter: '/',
          MaxKeys: 1000,
        })
      );

      const prefixes =
        response.CommonPrefixes?.map((p) => p.Prefix).filter(Boolean) || [];

      return prefixes;
    } catch (error) {
      lastError = error;
      const status = error?.$metadata?.httpStatusCode || error.status;
      if (status === 404) return [];
      continue;
    }
  }

  throw lastError;
};
