import { defineCollections, defineConfig } from 'fumadocs-mdx/config';

export const docs = defineCollections({
  type: 'doc',
  dir: './content/docs',
});

export default defineConfig({
  lastModifiedTime: 'git',
});
