import crypto from 'crypto';
import { getMaxBundleBytes } from './bundle-config.js';

const AWS_REGION = 'auto';
const SERVICE = 's3';

const toAmzDate = (date) => {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
};

const toDateStamp = (date) => toAmzDate(date).slice(0, 8);

const sha256Hex = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

const hmac = (key, value) =>
  crypto.createHmac('sha256', key).update(value).digest();

const getAwsCredentials = () => {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT_URL;
  const bucket = process.env.R2_BUCKET;

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error(
      'Missing R2 configuration. Ensure R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL, and R2_BUCKET are set.'
    );
  }

  return { accessKeyId, secretAccessKey, endpoint, bucket };
};

const encodePath = (value) =>
  value
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const signGetRequest = (key) => {
  const { accessKeyId, secretAccessKey, endpoint, bucket } =
    getAwsCredentials();

  const baseUrl = new URL(endpoint);
  const hostWithBucket = `${bucket}.${baseUrl.host}`;
  const encodedPath = encodePath(key);
  const path = `/${encodedPath}`;
  const url = new URL(`${baseUrl.protocol}//${hostWithBucket}${path}`);

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);

  const payloadHash = sha256Hex('');

  const canonicalHeaders = [
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ]
    .map((line) => line.trim())
    .join('\n');

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'GET',
    path,
    '', // query string
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${AWS_REGION}/${SERVICE}/aws4_request`;

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), AWS_REGION), SERVICE),
    'aws4_request'
  );

  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');

  const authorization = [
    'AWS4-HMAC-SHA256',
    `Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');

  const headers = {
    Authorization: authorization,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };

  return { url: url.toString(), headers };
};

export const fetchR2Object = async (key) => {
  const { url, headers } = signGetRequest(key);
  const maxBytes = getMaxBundleBytes();

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (response.status === 404) {
    return { status: 404 };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(
      `Failed to fetch R2 object (${response.status}): ${body || 'unknown'}`
    );
    error.status = response.status;
    throw error;
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const length = Number(contentLengthHeader);
    if (!Number.isNaN(length) && length > maxBytes) {
      const error = new Error('Requested object exceeds size limits');
      error.status = 413;
      throw error;
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    const error = new Error('Requested object exceeds size limits');
    error.status = 413;
    throw error;
  }

  const contentType =
    response.headers.get('content-type') || 'application/octet-stream';

  return {
    status: 200,
    buffer: Buffer.from(arrayBuffer),
    contentLength: arrayBuffer.byteLength,
    contentType,
  };
};
