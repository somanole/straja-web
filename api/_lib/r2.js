import crypto from 'crypto';
import { getMaxBundleBytes } from './bundle-config.js';

const SERVICE = 's3';
const REGION = 'auto';

const normalizeEndpoint = (value) => {
  const url = new URL(value);
  // Remove trailing slashes in pathname
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

  return { accessKeyId, secretAccessKey, endpoint: normalizeEndpoint(endpoint), bucket };
};

const encodePath = (value) =>
  value
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const buildRequest = ({ key, query = {}, addressing = 'virtual' }) => {
  const { accessKeyId, secretAccessKey, endpoint, bucket } = getCreds();

  const encodedKey = encodePath(key);

  let host;
  let path;

  if (addressing === 'path') {
    host = endpoint.host;
    path = `${endpoint.pathname || ''}/${bucket}/${encodedKey}`.replace(/\/+/g, '/');
  } else {
    host = `${bucket}.${endpoint.host}`;
    path = `${endpoint.pathname || ''}/${encodedKey}`.replace(/\/+/g, '/');
  }

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
  const addressingStyle = process.env.R2_ADDRESSING_STYLE || 'auto'; // auto | virtual | path
  const stylesToTry =
    addressingStyle === 'auto' ? ['virtual', 'path'] : [addressingStyle];

  let lastError;
  for (const style of stylesToTry) {
    try {
      const { url, headers } = buildRequest({ key, addressing: style });
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
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError;
};
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

const parseXmlPrefixes = (xmlString) => {
  const prefixes = [];
  const regex = /<Prefix>([^<]+)<\/Prefix>/g;
  let match;
  while ((match = regex.exec(xmlString)) !== null) {
    prefixes.push(match[1]);
  }
  return prefixes;
};

export const listR2Prefixes = async (prefix) => {
  const addressingStyle = process.env.R2_ADDRESSING_STYLE || 'auto';
  const stylesToTry =
    addressingStyle === 'auto' ? ['virtual', 'path'] : [addressingStyle];

  let lastError;
  for (const style of stylesToTry) {
    try {
      const { url, headers } = buildRequest({
        key: '',
        query: {
          'list-type': '2',
          delimiter: '/',
          'max-keys': '1000',
          prefix,
        },
        addressing: style,
      });

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = new Error(
          `Failed to list R2 objects (${response.status}): ${body || 'unknown'}`
        );
        error.status = response.status;
        throw error;
      }

      const text = await response.text();
      return parseXmlPrefixes(text);
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError;
};
