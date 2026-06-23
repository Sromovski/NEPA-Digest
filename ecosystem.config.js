module.exports = {
  apps: [
    {
      name: 'nepa-digest',
      script: 'ts-node',
      args: 'src/scheduler.ts',
      interpreter: 'none',
      cwd: __dirname,
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
