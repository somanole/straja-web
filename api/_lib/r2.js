import crypto from 'crypto';
import { getMaxBundleBytes } from './bundle-config.js';

const SERVICE = 's3';
const REGION = 'auto';

const normalizeEndpoint = (value) => {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
};

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

const getCreds = () => {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT_URL;
  const bucket = process.env.R2_BUCKET;

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error(
      'Missing R2 configuration. Ensure R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL, and R2_BUCKET are set.'
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint: normalizeEndpoint(endpoint),
    bucket,
  };
};

const encodePath = (value) =>
  value
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const resolveAddressing = (endpoint, bucket, override) => {
  if (override === 'path') {
    return {
      host: endpoint.host,
      basePath: `${endpoint.pathname || ''}/${bucket}`.replace(/\/+/g, '/'),
    };
  }
  if (override === 'virtual') {
    return { host: `${bucket}.${endpoint.host}`, basePath: endpoint.pathname || '' };
  }

  if (endpoint.host.startsWith(`${bucket}.`)) {
    return { host: endpoint.host, basePath: endpoint.pathname || '' };
  }

  const pathParts = (endpoint.pathname || '').split('/').filter(Boolean);
  if (pathParts[pathParts.length - 1] === bucket) {
    const withoutBucket = `/${pathParts.slice(0, -1).join('/')}`.replace(/\/+/g, '/');
    return { host: endpoint.host, basePath: withoutBucket };
  }

  return { host: `${bucket}.${endpoint.host}`, basePath: endpoint.pathname || '' };
};

const buildRequest = ({ key, query = {}, addressing }) => {
  const { accessKeyId, secretAccessKey, endpoint, bucket } = getCreds();

  const encodedKey = encodePath(key);
  const { host, basePath } = resolveAddressing(endpoint, bucket, addressing);
  const path = `${basePath}/${encodedKey}`.replace(/\/+/g, '/');

  const searchParams = new URLSearchParams();
  Object.keys(query)
    .sort()
    .forEach((name) => {
      const value = query[name];
      if (value === undefined || value === null) return;
      searchParams.append(name, value);
    });

  const canonicalQuery = searchParams.toString();

  const url = new URL(`${endpoint.protocol}//${host}${path}`);
  url.search = canonicalQuery;

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
    canonicalQuery,
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), REGION), SERVICE),
    'aws4_request'
  );
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');

  const headers = {
    Authorization: [
      'AWS4-HMAC-SHA256',
      `Credential=${accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', '),
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };

  return { url: url.toString(), headers };
};

const addressingOrder = () => {
  const env = process.env.R2_ADDRESSING_STYLE || 'auto';
  if (env === 'path') return ['path'];
  if (env === 'virtual') return ['virtual'];
  return ['path', 'virtual'];
};

const doRequest = async ({ key, query, binary }) => {
  const maxBytes = getMaxBundleBytes();
  let lastError;

  for (const style of addressingOrder()) {
    try {
      const { url, headers } = buildRequest({ key, query, addressing: style });
      const response = await fetch(url, { method: 'GET', headers });

      if (response.status === 404) {
        return { status: 404 };
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = new Error(
          `Failed R2 request (${response.status}): ${body || 'unknown'}`
        );
        error.status = response.status;
        throw error;
      }

      if (!binary) {
        return { status: 200, text: await response.text() };
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
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError;
};

export const fetchR2Object = async (key) => doRequest({ key, query: {}, binary: true });

export const listR2Prefixes = async (prefix) => {
  const result = await doRequest({
    key: '',
    query: {
      'list-type': '2',
      delimiter: '/',
      'max-keys': '1000',
      prefix,
    },
    binary: false,
  });

  if (result.status === 404) return [];

  const prefixes = [];
  const regex = /<Prefix>([^<]+)<\/Prefix>/g;
  let match;
  while ((match = regex.exec(result.text || '')) !== null) {
    prefixes.push(match[1]);
  }
  return prefixes;
};
