import { BUNDLE_MODEL_KEY } from './bundle-config.js';
import { fetchR2Object } from './r2.js';

const buildKeyVariants = (version, suffix) => [
  `${BUNDLE_MODEL_KEY}/${version}/${suffix}`,
  `${BUNDLE_MODEL_KEY}//${version}/${suffix}`,
];

export const fetchBundleObject = async (version, suffix) => {
  const keys = buildKeyVariants(version, suffix);
  let lastError;

  for (const key of keys) {
    try {
      const result = await fetchR2Object(key);
      if (result.status === 404) continue;
      return result;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  if (lastError) throw lastError;
  return { status: 404 };
};
