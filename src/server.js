import http from 'node:http';
import { PORT, HOST } from './config.js';
import { handleRequest } from './routes.js';

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[Unhandled Request Error]:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is busy. Waiting for port to free up...\n`);
    setTimeout(() => {
      server.close();
      server.listen(PORT, HOST);
    }, 1500);
  } else {
    console.error('[Server Error]:', err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n=================================================`);
  console.log(`  🎵 YouTube Music REST API Server Running`);
  console.log(`  🔗 Local:   http://localhost:${PORT}`);
  console.log(`  📖 Docs:    http://localhost:${PORT}/docs`);
  console.log(`  💡 About:   http://localhost:${PORT}/about`);
  console.log(`  💓 Health:  http://localhost:${PORT}/health`);
  console.log(`=================================================\n`);
});

function gracefulShutdown() {
  console.log('\nGracefully shutting down server...');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
