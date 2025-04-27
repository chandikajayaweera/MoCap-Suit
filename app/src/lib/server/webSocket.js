// WebSocket server implementation
import { WebSocketServer } from 'ws';
import { parse } from 'url';
import { sendCommand } from './serial.js';

// Create a unique symbol for global reference
export const GlobalThisWSS = Symbol.for('motion.capture.wss');

// Use symbols for connection properties
const kConnectionId = Symbol('connectionId');
const kConnectionTime = Symbol('connectionTime');
const kIsAlive = Symbol('isAlive');

/**
 * Create WebSocket server instance
 * @returns {WebSocketServer} - The WebSocket server
 */
export const createWSSGlobalInstance = () => {
	const wss = new WebSocketServer({ noServer: true });

	// Store in globalThis for access across the app
	globalThis[GlobalThisWSS] = wss;
	global.activeWebSocketClients = new Set();

	// Set up heartbeat for connection monitoring
	const heartbeatInterval = setInterval(function ping() {
		wss.clients.forEach(function each(client) {
			if (client[kIsAlive] === false) {
				console.log('Terminating inactive WebSocket connection');
				return client.terminate();
			}

			client[kIsAlive] = false;
			try {
				client.ping();
			} catch (e) {
				console.error('Error sending ping:', e);
			}
		});
	}, 30000);

	// Clean up interval on server close
	wss.on('close', function close() {
		clearInterval(heartbeatInterval);
	});

	wss.on('connection', (ws, request) => {
		global.activeWebSocketClients.add(ws);

		// Initialize WebSocket properties
		ws[kConnectionId] = Math.random().toString(36).substring(2, 15);
		ws[kConnectionTime] = new Date();
		ws[kIsAlive] = true;

		const clientIp = request.socket.remoteAddress;
		console.log(`WebSocket connected: ${ws[kConnectionId]} from ${clientIp}`);

		// Set up pong handler
		ws.on('pong', function heartbeat() {
			this[kIsAlive] = true;
		});

		// Send welcome message
		ws.send(
			JSON.stringify({
				type: 'log',
				message: '[SERVER] WebSocket connection established'
			})
		);

		// Handle incoming messages
		ws.on('message', (data) => {
			try {
				const message = JSON.parse(data.toString());

				// Handle command messages
				if (message.type === 'command' && message.command) {
					sendCommand(message.command);
				}

				// Handle pings
				if (message.type === 'ping') {
					ws.send(
						JSON.stringify({
							type: 'pong',
							timestamp: message.timestamp,
							serverTime: Date.now()
						})
					);
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

		ws.on('error', (error) => {
			console.error('WebSocket error:', error);
			global.activeWebSocketClients.delete(ws);
		});
	});

	return wss;
};

/**
 * Handle HTTP upgrade to WebSocket connection
 */
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

	// Handle socket errors
	socket.on('error', (err) => {
		console.error('Socket error during upgrade:', err);
		socket.destroy();
	});

	wss.handleUpgrade(req, socket, head, (ws) => {
		wss.emit('connection', ws, req);
	});
};

/**
 * Broadcast message to all connected WebSocket clients
 * @param {Object} data - Message data
 */
export const broadcast = (data) => {
	const wss = globalThis[GlobalThisWSS];
	if (!wss) return;

	// Check for sensorData to optimize broadcasting
	const isSensorData = data.type === 'sensorData';

	// Don't buffer sensor data - send immediately
	if (isSensorData) {
		// Prepare message
		const message = JSON.stringify(data);

		// Use immediate send for sensor data - don't use process.nextTick
		wss.clients.forEach((client) => {
			if (client.readyState === 1) {
				// OPEN
				try {
					// Skip buffer/nextTick for real-time data
					client.send(message);
				} catch (e) {
					console.error('Error broadcasting sensor data to client:', e);
				}
			}
		});
	} else {
		// For non-sensor data, use the original approach
		const message = JSON.stringify(data);

		// Use non-blocking for non-critical data
		process.nextTick(() => {
			wss.clients.forEach((client) => {
				if (client.readyState === 1) {
					// OPEN
					try {
						client.send(message);
					} catch (e) {
						console.error('Error broadcasting to client:', e);
					}
				}
			});
		});
	}
};
