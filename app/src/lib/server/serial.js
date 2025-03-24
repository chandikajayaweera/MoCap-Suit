import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

// Store global references
global.serialPort = null;
global.parser = null;
global.activeWebSocketClients = new Set();

// Connect to serial port
export async function connectToSerialPort(options) {
	try {
		if (global.serialPort && global.serialPort.isOpen) {
			await disconnectFromSerialPort();
		}

		console.log(`Connecting to ${options.port} at ${options.baudRate || 115200} baud`);

		// Create the SerialPort instance
		global.serialPort = new SerialPort({
			path: options.port,
			baudRate: options.baudRate || 115200,
			autoOpen: false
		});

		return new Promise((resolve, reject) => {
			global.serialPort.open((error) => {
				if (error) {
					console.error('Error opening serial port:', error);
					reject(error);
					return;
				}

				console.log('Serial port opened successfully');

				// Create parser for text data
				global.parser = global.serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

				// Handle data received from serial port
				global.parser.on('data', (data) => {
					console.log(
						`Received data from serial port: ${data.substring(0, 50)}${data.length > 50 ? '...' : ''}`
					);
					handleSerialData(data);
				});

				// Handle errors
				global.serialPort.on('error', (error) => {
					console.error('Serial port error:', error);
					broadcast({
						type: 'log',
						message: `[ERROR] Serial port error: ${error.message}`
					});
				});

				// Handle close events
				global.serialPort.on('close', () => {
					console.log('Serial port was closed');
					broadcast({
						type: 'log',
						message: '[INFO] Serial port connection closed'
					});
				});

				// Send connected notification
				broadcast({
					type: 'log',
					message: `[INFO] Connected to ${options.port} at ${options.baudRate || 115200} baud`
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
		if (!global.serialPort) {
			resolve(true);
			return;
		}

		if (global.serialPort.isOpen) {
			global.serialPort.close((error) => {
				if (error) {
					console.error('Error closing serial port:', error);
					reject(error);
					return;
				}

				console.log('Serial port closed successfully');
				global.serialPort = null;
				global.parser = null;
				resolve(true);
			});
		} else {
			global.serialPort = null;
			global.parser = null;
			resolve(true);
		}
	});
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

// Broadcast message to all connected WebSocket clients
function broadcast(data) {
	if (!global.activeWebSocketClients) return;

	const message = JSON.stringify(data);
	console.log(`Broadcasting to ${global.activeWebSocketClients.size} clients:`, data.type);

	for (const client of global.activeWebSocketClients) {
		try {
			// For SvelteKit's built-in WebSocket
			if (client.send) {
				client.send(message);
			}
		} catch (error) {
			console.error('Error broadcasting message:', error);
		}
	}
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
