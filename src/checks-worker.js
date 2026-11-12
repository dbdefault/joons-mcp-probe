import { parentPort, workerData } from 'node:worker_threads';
import { checkTools } from './checks/tools.js';
parentPort.postMessage(checkTools(workerData.rawTools, { deadline: workerData.deadline }));
