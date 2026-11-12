// Deliver the same JS SIGINT event on Windows, where process.kill(SIGINT) forcibly terminates Node.
process.on('message', message => { if (message === 'SIGINT') process.emit('SIGINT'); });
await import('../../bin/joons-mcp-probe.js');
process.disconnect();
