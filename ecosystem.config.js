module.exports = {
  apps: [
    {
      name: 'nepa-digest',
      script: 'src/scheduler.ts',
      interpreter: 'node',
      interpreter_args: '--require ts-node/register',
      cwd: __dirname,
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
