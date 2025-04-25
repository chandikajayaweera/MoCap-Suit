import { createServer } from 'http';
import { handler } from './build/handler.js';
import { createWSSGlobalInstance, onHttpServerUpgrade } from './src/lib/server/webSocketUtils.js';

// Get port from environment variable or use default
const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = createServer(handler);

// Initialize WebSocket server and attach to HTTP server
const wss = createWSSGlobalInstance();
server.on('upgrade', onHttpServerUpgrade);

// Start server
server.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
	console.log(`WebSocket server available at ws://localhost:${PORT}/api/ws`);
});
