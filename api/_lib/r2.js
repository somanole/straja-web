import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getMaxBundleBytes } from './bundle-config.js';

let s3Client;

const getClient = () => {
  if (s3Client) return s3Client;

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT_URL;
  const bucket = process.env.R2_BUCKET;

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error(
      'Missing R2 configuration. Ensure R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL, and R2_BUCKET are set.'
    );
  }

  s3Client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: process.env.R2_ADDRESSING_STYLE === 'path',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return s3Client;
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

export const fetchR2Object = async (key) => {
  const client = getClient();
  const maxBytes = getMaxBundleBytes();

  try {
    const response = await client.send(
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

    const bodyBuffer = await streamToBuffer(response.Body);
    if (bodyBuffer.byteLength > maxBytes) {
      const error = new Error('Requested object exceeds size limits');
      error.status = 413;
      throw error;
    }

    return {
      status: 200,
      buffer: bodyBuffer,
      contentLength: bodyBuffer.byteLength,
      contentType: response.ContentType || 'application/octet-stream',
    };
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) {
      return { status: 404 };
    }
    error.status = error?.$metadata?.httpStatusCode || error.status || 500;
    throw error;
  }
};

export const listR2Prefixes = async (prefix) => {
  const client = getClient();

  try {
    const response = await client.send(
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
    if (error?.$metadata?.httpStatusCode === 404) {
      return [];
    }
    error.status = error?.$metadata?.httpStatusCode || error.status || 500;
    throw error;
  }
};
