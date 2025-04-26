import { SerialPort } from 'serialport';
import { WebSocketServer } from 'ws';
import { ReadlineParser } from '@serialport/parser-readline';
import { GlobalThisWSS } from './webSocket.js';

// Store connections
let serialPort = null;
let parser = null;
let wss = null;
let activeClients = new Set();

// Setup WebSocket server
export function setupWebSocketServer(server) {
	// Make sure we don't create duplicate WebSocket servers
	if (wss) {
		console.log('WebSocket server already initialized');
		return wss;
	}

	console.log('Setting up WebSocket server');
	wss = new WebSocketServer({
		server,
		path: '/' // Accept connections on any path
	});

	wss.on('connection', (ws) => {
		console.log('WebSocket client connected');
		activeClients.add(ws);

		// Send a welcome message
		ws.send(
			JSON.stringify({
				type: 'log',
				message: '[SERVER] WebSocket connection established'
			})
		);

		ws.on('message', (message) => {
			try {
				handleWebSocketMessage(message, ws);
			} catch (error) {
				console.error('Error handling WebSocket message:', error);
			}
		});

		ws.on('close', () => {
			console.log('WebSocket client disconnected');
			activeClients.delete(ws);
		});

		ws.on('error', (error) => {
			console.error('WebSocket error:', error);
			activeClients.delete(ws);
		});
	});

	wss.on('error', (error) => {
		console.error('WebSocket server error:', error);
	});

	return wss;
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(message, ws) {
	try {
		const data = JSON.parse(message);

		if (data.type === 'command') {
			// Send command to serial port
			if (serialPort && serialPort.isOpen) {
				serialPort.write(data.command + '\n');
				console.log(`Command sent: ${data.command}`);
			} else {
				ws.send(
					JSON.stringify({
						type: 'log',
						message: '[ERROR] Serial port not connected'
					})
				);
			}
		}
	} catch (error) {
		console.error('Error handling WebSocket message:', error);
	}
}

// Broadcast message to all connected WebSocket clients
export const broadcast = (data) => {
	const wss = globalThis[GlobalThisWSS];
	if (!wss || !wss.clients || wss.clients.size === 0) return;

	// Prepare message once to avoid redundant JSON.stringify calls
	const message = JSON.stringify(data);

	// Use non-blocking, high-priority nextTick for better real-time performance
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
};

// Connect to serial port
export async function connectToSerialPort(options) {
	try {
		if (serialPort && serialPort.isOpen) {
			await disconnectFromSerialPort();
		}

		console.log(`Connecting to ${options.port} at ${options.baudRate || 115200} baud`);

		serialPort = new SerialPort({
			path: options.port,
			baudRate: options.baudRate || 115200,
			autoOpen: false
		});

		return new Promise((resolve, reject) => {
			serialPort.open((error) => {
				if (error) {
					console.error('Error opening serial port:', error);
					reject(error);
					return;
				}

				console.log('Serial port opened successfully');

				// Create parser for text data
				parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

				// Handle data received from serial port
				parser.on('data', (data) => {
					handleSerialData(data);
				});

				// Handle errors
				serialPort.on('error', (error) => {
					console.error('Serial port error:', error);
					broadcast({
						type: 'log',
						message: `[ERROR] Serial port error: ${error.message}`
					});
				});

				resolve(true);
			});
		});
	} catch (error) {
		console.error('Error connecting to serial port:', error);
		throw error;
	}
}

// Disconnect from serial port
export async function disconnectFromSerialPort() {
	return new Promise((resolve, reject) => {
		if (!serialPort) {
			resolve(true);
			return;
		}

		if (serialPort.isOpen) {
			serialPort.close((error) => {
				if (error) {
					console.error('Error closing serial port:', error);
					reject(error);
					return;
				}

				console.log('Serial port closed successfully');
				serialPort = null;
				parser = null;
				resolve(true);
			});
		} else {
			serialPort = null;
			parser = null;
			resolve(true);
		}
	});
}

// Handle data received from serial port
function handleSerialData(data) {
	try {
		if (data.startsWith('DATA:')) {
			// Process sensor data
			handleSensorData(data.substring(5));
		} else if (data.startsWith('LOG:')) {
			// Process log message
			broadcast({
				type: 'log',
				message: data.substring(4)
			});
		} else {
			// Unknown format, treat as log
			broadcast({
				type: 'log',
				message: data
			});
		}
	} catch (error) {
		console.error('Error handling serial data:', error);
	}
}

// Parse and handle sensor data
function handleSensorData(data) {
	try {
		// Optimized extraction of data portion using string operations instead of regex
		let cleanData = '';
		let sensorData = null;

		if (data.startsWith('DATA:QUAT_DATA:')) {
			// Skip the prefixes and any whitespace
			cleanData = data.substring('DATA:QUAT_DATA:'.length).trim();
			sensorData = parseSensorDataDirect(cleanData);
		} else if (data.startsWith('QUAT_DATA:')) {
			// Skip the prefix and any whitespace
			cleanData = data.substring('QUAT_DATA:'.length).trim();
			sensorData = parseSensorDataDirect(cleanData);
		} else {
			// Not a sensor data packet, handle as regular message
			return;
		}

		// Only broadcast if we have valid data
		if (sensorData && (sensorData.sequence !== undefined || Object.keys(sensorData).length > 0)) {
			// Use process.nextTick to prioritize broadcasting before other processing
			process.nextTick(() => {
				broadcast({
					type: 'sensorData',
					data: {
						timestamp: Date.now(),
						sensorData: sensorData
					}
				});
			});
		}
	} catch (error) {
		console.error('Error handling sensor data:', error);
	}
}

// Parse quaternion sensor data

/**
 * Direct string parsing function optimized for speed and minimal memory allocation
 * Avoids regex for better performance and less GC pressure
 */
function parseSensorDataDirect(data) {
	const result = {};

	try {
		// Fast path for sequence extraction
		if (data.indexOf('SEQ:') === 0) {
			const commaPos = data.indexOf(',');
			if (commaPos > 4) {
				const seqStr = data.substring(4, commaPos);
				result.sequence = parseInt(seqStr, 10);
			}
		}

		// Fast sensor data extraction using indexOf - much faster than regex
		let currentPos = 0;
		const dataLen = data.length;

		while ((currentPos = data.indexOf('S', currentPos)) !== -1) {
			// Skip invalid patterns
			if (currentPos + 1 >= dataLen) break;

			// Check if next char is a digit
			const idChar = data[currentPos + 1];
			if (idChar < '0' || idChar > '9') {
				currentPos++;
				continue;
			}

			// Extract sensor ID
			const colonPos = data.indexOf(':', currentPos);
			if (colonPos === -1) break;

			const sensorId = data.substring(currentPos + 1, colonPos);

			// Extract values array
			const bracketOpen = data.indexOf('[', colonPos);
			if (bracketOpen === -1) break;

			const bracketClose = data.indexOf(']', bracketOpen);
			if (bracketClose === -1) break;

			// Extract values and parse
			const valuesStr = data.substring(bracketOpen + 1, bracketClose);
			const values = [];

			// Manual split and parse for better performance
			let valueStart = 0;
			let valueEnd = 0;
			let valueIdx = 0;

			while (valueIdx < 4 && valueEnd < valuesStr.length) {
				valueEnd = valuesStr.indexOf(',', valueStart);

				if (valueEnd === -1) {
					// Last value
					values.push(parseFloat(valuesStr.substring(valueStart)));
					break;
				} else {
					values.push(parseFloat(valuesStr.substring(valueStart, valueEnd)));
					valueStart = valueEnd + 1;
					valueIdx++;
				}
			}

			// Only add complete sensor data
			if (values.length === 4) {
				result[`S${sensorId}`] = values;
			}

			currentPos = bracketClose + 1;
		}
	} catch (e) {
		console.error('Error in direct sensor data parsing:', e);
	}

	return result;
}

// List available serial ports
export async function listSerialPorts() {
	try {
		const ports = await SerialPort.list();
		return ports;
	} catch (error) {
		console.error('Error listing serial ports:', error);
		throw error;
	}
}
