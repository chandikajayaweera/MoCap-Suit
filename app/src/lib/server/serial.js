import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

// Store global references
global.serialPort = null;
global.parser = null;
global.activeWebSocketClients = new Set();
global.originalPortPath = null;
global.lastBaudRate = 115200;
let portMonitorInterval = null;

/**
 * Connect to serial port with improved handling to prevent device resets
 * @param {Object} options - Connection options
 * @param {string} options.port - Port path
 * @param {number} options.baudRate - Baud rate
 * @param {boolean} options.dtrControl - Whether to control DTR line
 * @returns {Promise<boolean>} - Success status
 */
export async function connectToSerialPort(options) {
	try {
		// Store original port for reconnection logic
		global.originalPortPath = options.port;
		global.lastBaudRate = options.baudRate || 115200;

		if (global.serialPort && global.serialPort.isOpen) {
			await disconnectFromSerialPort();
		}

		console.log(`Connecting to ${options.port} at ${global.lastBaudRate} baud`);

		// Create the SerialPort instance with options that prevent reset
		global.serialPort = new SerialPort({
			path: options.port,
			baudRate: global.lastBaudRate,
			autoOpen: false,
			// Disable flow control options that might cause issues
			rtscts: false,
			xon: false,
			xoff: false
		});

		return new Promise((resolve, reject) => {
			// Open the port first, then we'll set DTR/RTS after it's open
			global.serialPort.open((error) => {
				if (error) {
					console.error('Error opening serial port:', error);
					reject(error);
					return;
				}

				console.log('Serial port opened successfully');

				// After opening, explicitly set DTR/RTS to prevent device reset
				// The port is now guaranteed to be open
				if (options.dtrControl === false) {
					// Set a slight delay before setting DTR/RTS to ensure port is fully ready
					setTimeout(() => {
						try {
							if (global.serialPort && global.serialPort.isOpen) {
								global.serialPort.set({ dtr: false, rts: false });
								console.log('DTR/RTS signals set to prevent device reset');
							}
						} catch (err) {
							console.warn('Could not set DTR/RTS signals after open:', err);
						}
					}, 100);
				}

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
					message: `[INFO] Connected to ${options.port} at ${global.lastBaudRate} baud`
				});

				// Start port monitoring for automatic reconnection
				// with a small delay to ensure port is fully initialized
				setTimeout(() => {
					if (global.serialPort && global.serialPort.isOpen) {
						startPortMonitoring();
					}
				}, 500);

				resolve(true);
			});
		});
	} catch (error) {
		console.error('Error connecting to serial port:', error);
		throw error;
	}
}

/**
 * Disconnect from serial port with improved cleanup
 * @returns {Promise<boolean>} - Success status
 */
export async function disconnectFromSerialPort() {
	// Stop port monitoring
	stopPortMonitoring();

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

/**
 * Check if the port has changed (happens after device reset)
 * @returns {Promise<string|null>} - New port path or null
 */
async function checkForPortChange() {
	// Don't check if we're not connected
	if (!global.serialPort || !global.serialPort.isOpen || !global.originalPortPath) {
		return null;
	}

	try {
		const ports = await SerialPort.list();

		// First check if current port is still valid
		const currentPortExists = ports.some((p) => p.path === global.serialPort.path);

		if (!currentPortExists) {
			console.log(
				`Current port ${global.serialPort.path} no longer found. Looking for relocated device...`
			);

			// Find our original port info to get manufacturer/serial info
			const originalPortInfo = ports.find((p) => p.path === global.originalPortPath);

			// If we can't find original info, try to find similar devices
			if (!originalPortInfo) {
				// Look for ESP32 devices or devices with similar patterns
				const possiblePorts = ports.filter(
					(p) =>
						// Common ESP32 manufacturer strings or USB IDs
						(p.manufacturer &&
							(p.manufacturer.includes('Silicon Labs') || p.manufacturer.includes('Espressif'))) ||
						(p.vendorId === '10c4' && p.productId === 'ea60') || // Common ESP32 USB VID/PID
						(p.vendorId === '1a86' && p.productId === '7523') // CH340 converter often used with ESP32
				);

				if (possiblePorts.length === 1) {
					return possiblePorts[0].path;
				} else if (possiblePorts.length > 1) {
					// If multiple matches, use the one with lowest port number as it's likely
					// the one that was just reconnected
					possiblePorts.sort((a, b) => {
						// Extract number from COM port or similar
						const numA = parseInt(a.path.replace(/\D/g, '')) || 0;
						const numB = parseInt(b.path.replace(/\D/g, '')) || 0;
						return numA - numB;
					});
					return possiblePorts[0].path;
				}
			} else {
				// Use the manufacturer and other identifiers to find the same device on a new port
				const newPort = ports.find(
					(p) =>
						p.path !== global.serialPort.path &&
						p.path !== global.originalPortPath &&
						p.manufacturer === originalPortInfo.manufacturer &&
						p.serialNumber === originalPortInfo.serialNumber
				);

				if (newPort) {
					return newPort.path;
				}
			}
		}
	} catch (error) {
		console.error('Error checking for port change:', error);
	}

	return null;
}

/**
 * Start monitoring for port changes
 */
export function startPortMonitoring() {
	// Only start monitoring if we're not already monitoring and we have a connected port
	if (portMonitorInterval || !global.serialPort || !global.serialPort.isOpen) {
		return;
	}

	console.log('Starting port monitoring...');

	// Check every 2 seconds for port changes
	portMonitorInterval = setInterval(async () => {
		if (global.serialPort && global.serialPort.isOpen) {
			const newPort = await checkForPortChange();

			if (newPort) {
				console.log(`Device reconnected on new port: ${newPort}. Attempting to reconnect...`);

				// Close the current port
				await disconnectFromSerialPort();

				// Wait a bit for the port to be fully available
				await new Promise((resolve) => setTimeout(resolve, 1500));

				// Reconnect to the new port
				try {
					await connectToSerialPort({
						port: newPort,
						baudRate: global.lastBaudRate,
						dtrControl: false
					});

					// Broadcast the reconnection
					broadcast({
						type: 'log',
						message: `[INFO] Automatically reconnected to new port ${newPort}`
					});
				} catch (error) {
					console.error('Failed to reconnect to new port:', error);
					broadcast({
						type: 'log',
						message: `[ERROR] Failed to reconnect to new port ${newPort}: ${error.message}`
					});
				}
			}
		}
	}, 2000);
}

/**
 * Stop port monitoring
 */
export function stopPortMonitoring() {
	if (portMonitorInterval) {
		clearInterval(portMonitorInterval);
		portMonitorInterval = null;
	}
}

/**
 * List available serial ports
 * @returns {Promise<Array>} - List of ports
 */
export async function listSerialPorts() {
	try {
		const ports = await SerialPort.list();
		return ports;
	} catch (error) {
		console.error('Error listing serial ports:', error);
		throw error;
	}
}

/**
 * Broadcast message to all connected WebSocket clients
 * @param {Object} data - Message data
 */
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

/**
 * Handle data received from serial port
 * @param {string} data - Received data
 */
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

/**
 * Parse and handle sensor data
 * @param {string} data - Sensor data
 */
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

/**
 * Parse quaternion sensor data
 * @param {string} data - Raw sensor data string
 * @returns {Object} - Parsed sensor data
 */
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
