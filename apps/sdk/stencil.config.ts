import { Config } from '@stencil/core';

export const config: Config = {
  namespace: 'smc-chat-widget',
  devServer: {
    port: 3000,
    openBrowser: false,
    reloadStrategy: 'pageReload',
  },
  outputTargets: [
    {
      type: 'dist',
      esmLoaderPath: '../loader',
    },
    {
      type: 'dist-custom-elements',
    },
    {
      type: 'www',
      serviceWorker: null,
      copy: [{ src: 'index.html' }],
    },
  ],
};
