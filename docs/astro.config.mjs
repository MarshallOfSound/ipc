import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the EIPC TextMate grammar
const eipcGrammar = JSON.parse(
  readFileSync(join(__dirname, 'src/eipc.tmLanguage.json'), 'utf-8')
);

export default defineConfig({
  site: 'https://marshallofsound.github.io',
  base: '/ipc',
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
      langs: [
        {
          id: 'eipc',
          scopeName: 'source.eipc',
          grammar: eipcGrammar,
          aliases: ['eipc'],
        },
      ],
    },
  },
});
