export const POLYMARKET_CLASSIFIER_VERSION = '0.1.0';

/** Public Polymarket Gamma REST host. */
export const GAMMA_BASE_URL = 'https://gamma-api.polymarket.com';

/** Public Polymarket CLOB REST host. */
export const CLOB_BASE_URL = 'https://clob.polymarket.com';

/** Hard ceiling for any single client request. Polymarket public APIs do not need long fetches. */
export const POLYMARKET_FETCH_TIMEOUT_MS = 15_000;

/** Default page size for keyset paging against Gamma /events. */
export const GAMMA_DEFAULT_PAGE_LIMIT = 100;

/** Polymarket Gamma tag id for generated Counter-Strike 2 markets. */
export const GAMMA_CS2_TAG_ID = 100780;
