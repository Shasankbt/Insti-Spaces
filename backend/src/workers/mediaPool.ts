import Piscina from 'piscina';
import path from 'path';

// __filename ends in '.ts' when running under tsx (dev), '.js' when compiled (prod).
const IS_TS = __filename.endsWith('.ts');
const workerFile = path.resolve(__dirname, IS_TS ? 'mediaWorker.ts' : 'mediaWorker.js');

export const mediaPool = new Piscina({
  filename: workerFile,
  execArgv: IS_TS ? ['--require', 'tsx/cjs'] : [],
  maxThreads: 4,
  minThreads: 0,
  idleTimeout: 60_000,
});
