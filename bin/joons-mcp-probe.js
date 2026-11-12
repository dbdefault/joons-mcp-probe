#!/usr/bin/env node
import { main } from '../src/cli.js';

// Keep the process alive while the probe's own SIGINT cleanup runs.
const onInterrupt = () => {};
process.on('SIGINT', onInterrupt);
try { process.exitCode = await main(); }
finally { process.off('SIGINT', onInterrupt); }
