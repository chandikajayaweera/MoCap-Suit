// Optimized WebSocket server implementation for real-time streaming
// src/lib/server/webSocket.js

import { WebSocketServer } from 'ws';
import { parse } from 'url';

// Create a unique symbol for global reference
export const GlobalThisWSS = Symbol.for('motion.capture.wss');

// Use symbols for custom properties
const kConnectionId = Symbol('connectionId');
const kConnectionTime = Symbol('connectionTime');
const kIsAlive = Symbol('isAlive');

export const createWSSGlobalInstance = () => {
	const wss = new WebSocketServer({ noServer: true });

	// Store in globalThis for access across the app
	globalThis[GlobalThisWSS] = wss;
	global.activeWebSocketClients = new Set();

	// Set up heartbeat interval to detect broken connections
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
	}, 30000); // 30 second interval

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

		// Use the request parameter to extract client information
		const clientIp = request.socket.remoteAddress;
		console.log(`WebSocket connected: ${ws[kConnectionId]} from ${clientIp}`);

		// Set up pong handler to mark connection as alive
		ws.on('pong', function heartbeat() {
			this[kIsAlive] = true;
		});

		console.log(`WebSocket connected: ${ws[kConnectionId]}`);

		// Send immediate welcome to reduce perceived latency
		ws.send(
			JSON.stringify({
				type: 'log',
				message: '[SERVER] WebSocket connection established'
			})
		);

		// Handle incoming messages from clients
		ws.on('message', (data) => {
			try {
				const message = JSON.parse(data.toString());

				// Handle command messages
				if (message.type === 'command' && message.command) {
					handleCommand(message.command);
				}

				// Handle pings for round-trip testing
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

	// Function to handle serial port commands
	const handleCommand = (command) => {
		if (global.serialPort && global.serialPort.isOpen) {
			global.serialPort.write(command + '\n');
			console.log(`Command sent to serial port: ${command}`);

			// Broadcast confirmation to all clients
			broadcast({
				type: 'log',
				message: `[INFO] Command sent: ${command}`
			});
		} else {
			// Broadcast error to all clients
			broadcast({
				type: 'log',
				message: '[ERROR] Serial port not connected'
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

	// Optimize WebSocket upgrade process
	socket.on('error', (err) => {
		console.error('Socket error during upgrade:', err);
		socket.destroy();
	});

	wss.handleUpgrade(req, socket, head, (ws) => {
		wss.emit('connection', ws, req);
	});
};

// Efficient broadcast to all connected WebSocket clients
export const broadcast = (data) => {
	const wss = globalThis[GlobalThisWSS];
	if (!wss) return;

	// Prepare message once to avoid redundant JSON.stringify calls
	const message = JSON.stringify(data);

	// Use forEach directly on the clients Set for better performance
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
};
