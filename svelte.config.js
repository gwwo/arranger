import adapter from "svelte-adapter-bun";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    // adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
    // If your environment is not supported, or you settled on a specific environment, switch out the adapter.
    // See https://svelte.dev/docs/kit/adapters for more information about adapters.
    // precompress: emit gzip/brotli copies of assets at build time so the
    // production bun server serves them compressed (~465 KB -> ~149 KB of JS+CSS),
    // cutting time-to-interactive on slow networks. No effect on `vite dev`.
    adapter: adapter({ precompress: true }),
  },
};

export default config;
