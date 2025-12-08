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
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const encodeQuery = (query) =>
  Object.keys(query)
    .sort()
    .map((key) => {
      const val = query[key];
      if (val === undefined || val === null) return '';
      return `${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`;
    })
    .filter(Boolean)
    .join('&');

const buildSignedUrl = ({
  method = 'GET',
  key,
  query = {},
  style = 'virtual',
}) => {
  const { accessKeyId, secretAccessKey, endpoint, bucket } =
    getAwsCredentials();

  const baseUrl = new URL(endpoint);
  const encodedPath = encodePath(key);
  const canonicalQuery = encodeQuery(query);

  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  const bucketInHost = baseUrl.host.startsWith(`${bucket}.`);
  const bucketInPath =
    basePath === `/${bucket}` || basePath === `/${bucket}/`;

  let host = baseUrl.host;
  let path = `/${encodedPath}`;

  if (bucketInHost) {
    host = baseUrl.host;
    path = `${basePath}/${encodedPath}`.replace(/\/+/g, '/');
  } else if (bucketInPath) {
    host = baseUrl.host;
    path = `${basePath}/${encodedPath}`.replace(/\/+/g, '/');
  } else if (style === 'path') {
    host = baseUrl.host;
    path = `${basePath}/${bucket}/${encodedPath}`.replace(/\/+/g, '/');
  } else {
    host = `${bucket}.${baseUrl.host}`;
    path = `${basePath}/${encodedPath}`.replace(/\/+/g, '/');
  }

  const url = new URL(`${baseUrl.protocol}//${host}${path}`);
  url.search = canonicalQuery;

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);

  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalHeaders = [
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ]
    .map((line) => line.trim())
    .join('\n');

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
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

const defaultAddressingStyle =
  process.env.R2_ADDRESSING_STYLE || 'auto'; // auto | virtual | path

const performSignedRequest = async ({ key, query, expectBinary = true }) => {
  const stylesToTry =
    defaultAddressingStyle === 'auto'
      ? ['virtual', 'path']
      : [defaultAddressingStyle];

  let lastError;
  for (const style of stylesToTry) {
    try {
      const { url, headers } = buildSignedUrl({ key, query, style });
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

      if (!expectBinary) {
        const text = await response.text();
        return { status: 200, text };
      }

      const maxBytes = getMaxBundleBytes();
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
      // Try next style if available
      continue;
    }
  }

  throw lastError;
};

export const fetchR2Object = async (key) => {
  return performSignedRequest({ key, query: {}, expectBinary: true });
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
  const query = {
    'list-type': '2',
    delimiter: '/',
    prefix,
    'max-keys': '1000',
  };

  const result = await performSignedRequest({
    key: '',
    query,
    expectBinary: false,
  });

  if (result.status === 404) return [];

  return parseXmlPrefixes(result.text || '');
};
