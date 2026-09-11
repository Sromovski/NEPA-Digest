module.exports = {
  apps: [
    {
      name: 'nepa-digest',
      script: 'src/scheduler.ts',
      interpreter: 'node',
      // transpile-only: type-checking at runtime held a ~2 GB TypeScript
      // Program in memory for the life of the process (221 MB without it).
      // Types are checked by `npm run typecheck`, not by the scheduler.
      interpreter_args: '--require ts-node/register/transpile-only',
      cwd: __dirname,
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
