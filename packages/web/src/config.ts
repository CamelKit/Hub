/**
 * API configuration for CamelKit Hub Web Frontend.
 * Prioritizes explicitly configured PUBLIC_API_URL, then falls back to localhost in dev or api.camelkit.dev in prod.
 */
export const API_URL = 
  import.meta.env.PUBLIC_API_URL || 
  (import.meta.env.DEV ? 'http://localhost:8787' : 'https://api.camelkit.dev');
