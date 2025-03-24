import { SerialPort } from 'serialport';
import { WebSocketServer } from 'ws';
import { ReadlineParser } from '@serialport/parser-readline';

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
function broadcast(data) {
	if (!wss) return;

	const message = JSON.stringify(data);
	for (const client of activeClients) {
		if (client.readyState === 1) {
			// OPEN
			client.send(message);
		}
	}
}

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
		// Check if it starts with QUAT_DATA prefix
		if (data.startsWith('QUAT_DATA:')) {
			const sensorData = parseSensorData(data.substring(10));

			broadcast({
				type: 'sensorData',
				data: {
					timestamp: Date.now(),
					sensorData: sensorData
				}
			});
		}
	} catch (error) {
		console.error('Error handling sensor data:', error);
	}
}

// Parse quaternion sensor data
function parseSensorData(data) {
	const result = {};

	// Expected format: SEQ:{seq},S0:[w,x,y,z],S1:[w,x,y,z],...
	const parts = data.split(',');

	// Extract sequence number
	if (parts[0].startsWith('SEQ:')) {
		result.sequence = parseInt(parts[0].substring(4), 10);
	}

	// Extract sensor data
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i];
		const sensorMatch = part.match(/S(\d+):\[([^\]]+)\]/);

		if (sensorMatch) {
			const sensorIndex = sensorMatch[1];
			const values = sensorMatch[2].split(',').map(Number);

			if (values.length === 4) {
				result[`S${sensorIndex}`] = values;
			}
		}
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
