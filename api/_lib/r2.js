import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getMaxBundleBytes } from './bundle-config.js';

let client;

const getClient = () => {
  if (client) return client;

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT_URL;
  const bucket = process.env.R2_BUCKET;

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error(
      'Missing R2 configuration. Ensure R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL, and R2_BUCKET are set.'
    );
  }

  client = new S3Client({
    region: 'auto',
    endpoint,
    // R2 often prefers path-style; allow env override but default to true
    forcePathStyle:
      process.env.R2_ADDRESSING_STYLE === 'virtual'
        ? false
        : true,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

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
  const s3 = getClient();
  const maxBytes = getMaxBundleBytes();

  try {
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
    const status = error?.$metadata?.httpStatusCode || error.status;
    if (status === 404) {
      return { status: 404 };
    }
    error.status = status || 500;
    throw error;
  }
};

export const listR2Prefixes = async (prefix) => {
  const s3 = getClient();

  try {
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
    const status = error?.$metadata?.httpStatusCode || error.status;
    if (status === 404) {
      return [];
    }
    error.status = status || 500;
    throw error;
  }
};
