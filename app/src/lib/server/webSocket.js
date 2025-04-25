import { WebSocketServer } from 'ws';
import { parse } from 'url';

// Create a unique symbol for global reference
export const GlobalThisWSS = Symbol.for('motion.capture.wss');

// Use symbols for custom properties to avoid TypeScript errors
const kConnectionId = Symbol('connectionId');
const kConnectionTime = Symbol('connectionTime');

export const createWSSGlobalInstance = () => {
	const wss = new WebSocketServer({ noServer: true });

	// Store in globalThis for access across the app
	globalThis[GlobalThisWSS] = wss;
	global.activeWebSocketClients = new Set();

	wss.on('connection', (ws, request) => {
		global.activeWebSocketClients.add(ws);
		// Add unique ID and timestamp using symbols to avoid TypeScript errors
		ws[kConnectionId] = Math.random().toString(36).substring(2, 15);
		ws[kConnectionTime] = new Date();

		console.log(`WebSocket connected: ${ws[kConnectionId]}`);

		// Handle incoming messages from clients
		ws.on('message', (data) => {
			try {
				const message = JSON.parse(data.toString());

				// Handle command messages
				if (message.type === 'command' && message.command) {
					handleCommand(message.command);
				}
			} catch (error) {
				console.error('Error processing WebSocket message:', error);
			}
		});

		// Handle client disconnection
		ws.on('close', () => {
			console.log(`WebSocket disconnected: ${ws[kConnectionId]}`);
			global.activeWebSocketClients.delete(ws);
		});
	});

	// Function to handle serial port commands
	const handleCommand = (command) => {
		if (global.serialPort && global.serialPort.isOpen) {
			global.serialPort.write(command + '\n');
			console.log(`Command sent to serial port: ${command}`);

			// Broadcast confirmation to all clients
			wss.clients.forEach((client) => {
				if (client.readyState === 1) {
					// OPEN
					client.send(
						JSON.stringify({
							type: 'log',
							message: `[INFO] Command sent: ${command}`
						})
					);
				}
			});
		} else {
			// Broadcast error to all clients
			wss.clients.forEach((client) => {
				if (client.readyState === 1) {
					// OPEN
					client.send(
						JSON.stringify({
							type: 'log',
							message: '[ERROR] Serial port not connected'
						})
					);
				}
			});
		}
	};

	return wss;
};

// Handle HTTP upgrade to WebSocket connection
export const onHttpServerUpgrade = (req, socket, head) => {
	const pathname = req.url ? parse(req.url).pathname : null;

	// Only handle WebSocket connections to /api/ws
	if (pathname !== '/api/ws') return;

	const wss = globalThis[GlobalThisWSS];
	if (!wss) {
		console.error('WebSocket server not initialized');
		socket.destroy();
		return;
	}

	wss.handleUpgrade(req, socket, head, (ws) => {
		wss.emit('connection', ws, req);
	});
};

// Broadcast to all connected WebSocket clients
export const broadcast = (data) => {
	const wss = globalThis[GlobalThisWSS];
	if (!wss) return;

	const message = JSON.stringify(data);

	wss.clients.forEach((client) => {
		if (client.readyState === 1) {
			// OPEN
			client.send(message);
		}
	});
};
