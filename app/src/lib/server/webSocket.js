// WebSocket server implementation
import { WebSocketServer } from 'ws';
import { parse } from 'url';
import { sendCommand } from './serial.js';

export const GlobalThisWSS = Symbol.for('motion.capture.wss');

const kConnectionId = Symbol('connectionId');
const kConnectionTime = Symbol('connectionTime');
const kIsAlive = Symbol('isAlive');

export const createWSSGlobalInstance = () => {
	const wss = new WebSocketServer({ noServer: true });

	globalThis[GlobalThisWSS] = wss;
	global.activeWebSocketClients = new Set();

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

	wss.on('close', function close() {
		clearInterval(heartbeatInterval);
	});

	wss.on('connection', (ws, request) => {
		global.activeWebSocketClients.add(ws);

		ws[kConnectionId] = Math.random().toString(36).substring(2, 15);
		ws[kConnectionTime] = new Date();
		ws[kIsAlive] = true;

		const clientIp = request.socket.remoteAddress;
		console.log(`WebSocket connected: ${ws[kConnectionId]} from ${clientIp}`);

		ws.on('pong', function heartbeat() {
			this[kIsAlive] = true;
		});

		ws.send(
			JSON.stringify({
				type: 'log',
				message: '[SERVER] WebSocket connection established'
			})
		);

		ws.on('message', (data) => {
			try {
				const message = JSON.parse(data.toString());

				if (message.type === 'command' && message.command) {
					sendCommand(message.command);
				}

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

export const onHttpServerUpgrade = (req, socket, head) => {
	const pathname = req.url ? parse(req.url).pathname : null;

	if (pathname !== '/api/ws') return;

	const wss = globalThis[GlobalThisWSS];
	if (!wss) {
		console.error('WebSocket server not initialized');
		socket.destroy();
		return;
	}

	socket.on('error', (err) => {
		console.error('Socket error during upgrade:', err);
		socket.destroy();
	});

	wss.handleUpgrade(req, socket, head, (ws) => {
		wss.emit('connection', ws, req);
	});
};

export const broadcast = (data) => {
	const wss = globalThis[GlobalThisWSS];
	if (!wss) return;

	const isSensorData = data.type === 'sensorData';

	if (isSensorData) {
		const message = JSON.stringify(data);

		wss.clients.forEach((client) => {
			if (client.readyState === 1) {
				try {
					client.send(message);
				} catch (e) {
					console.error('Error broadcasting sensor data to client:', e);
				}
			}
		});
	} else {
		const message = JSON.stringify(data);

		process.nextTick(() => {
			wss.clients.forEach((client) => {
				if (client.readyState === 1) {
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
