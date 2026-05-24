export default () => ({
  app: {
    name: process.env.APP_NAME ?? 'humlinker-api',
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
  },
});
