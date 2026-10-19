import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cspMetaTag } from './src/config/csp.js';

/**
 * Writes the Content Security Policy into the built `index.html`.
 *
 * Build only, which is the whole reason this is a plugin rather than a line in
 * `index.html`. In development `@vitejs/plugin-react` injects an inline React
 * Refresh preamble and Vite serves its own HMR client, so a `script-src 'self'`
 * policy sitting in the source document would break `npm run dev` and would
 * invite exactly the wrong fix: relaxing the policy that ships to production so
 * that the dev server is happy.
 *
 * The tag goes immediately after the charset declaration: before anything the
 * document loads, because a policy declared after a script has nothing to say
 * about that script, but after `<meta charset>`, because the encoding should be
 * settled before the parser reads a policy it then has to interpret.
 */
const CHARSET_META = '<meta charset="UTF-8" />';

function contentSecurityPolicy(): Plugin {
  return {
    name: 'teachneat-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(CHARSET_META)) {
        // Refuse rather than fall back to appending somewhere plausible: a CSP
        // in the wrong place looks present and protects nothing, and a silently
        // misplaced one is worse than a failed build.
        throw new Error(
          `CSP injection expected ${CHARSET_META} in index.html and did not find it.`,
        );
      }
      return html.replace(CHARSET_META, `${CHARSET_META}\n    ${cspMetaTag()}`);
    },
  };
}

// Proxy /api to the local server so the client and server share an origin
// in development. This avoids cross-origin cookie handling and matches how
// the app will run in production (same-origin reverse proxy).
export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
});
