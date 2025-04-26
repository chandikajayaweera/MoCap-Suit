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

		console.log(
			`Connecting to ${options.port} at ${global.lastBaudRate} baud with real-time optimization`
		);

		// Create the SerialPort instance with optimized settings for real-time data
		global.serialPort = new SerialPort({
			path: options.port,
			baudRate: global.lastBaudRate,
			autoOpen: false,
			// Critical for real-time: Disable all buffering and flow control
			rtscts: false, // No hardware flow control
			xon: false, // No software flow control
			xoff: false, // No software flow control
			hupcl: false, // Don't drop DTR on close
			highWaterMark: 64 // Small buffer size for minimal latency
		});

		return new Promise((resolve, reject) => {
			// Open the port first, then set additional options
			global.serialPort.open((error) => {
				if (error) {
					console.error('Error opening serial port:', error);
					reject(error);
					return;
				}

				console.log('Serial port opened successfully');

				// After opening, explicitly set DTR/RTS to prevent device reset
				setTimeout(() => {
					try {
						if (global.serialPort && global.serialPort.isOpen) {
							global.serialPort.set({
								dtr: false, // Disable DTR to prevent reset
								rts: false, // Disable RTS
								brk: false // No break condition
							});
							console.log('Serial port configured for real-time streaming');
						}
					} catch (err) {
						console.warn('Could not set DTR/RTS signals after open:', err);
					}
				}, 100);

				// Create parser for text data with smaller chunk size
				global.parser = global.serialPort.pipe(
					new ReadlineParser({
						delimiter: '\n',
						encoding: 'utf8',
						includeDelimiter: false
					})
				);

				// For optimal real-time performance, process data immediately
				global.parser.on('data', (data) => {
					// Skip verbose logging for sensor data to improve performance
					if (data.startsWith('DATA:') || data.startsWith('QUAT_DATA:')) {
						// Process sensor data without delays
						process.nextTick(() => handleSerialData(data));
					} else {
						// Handle logs and other messages normally
						handleSerialData(data);
					}
				});

				// Handle errors
				global.serialPort.on('error', (error) => {
					console.error('Serial port error:', error);
					broadcast({
						type: 'log',
						message: `[ERROR] Serial port error: ${error.message}`
					});
				});

				// Send connected notification
				broadcast({
					type: 'log',
					message: `[INFO] Connected to ${options.port} at ${global.lastBaudRate} baud with real-time optimization`
				});

				// Start port monitoring for automatic reconnection
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
		// Skip verbose logging for data packets to reduce CPU usage
		if (data.startsWith('DATA:') || data.startsWith('QUAT_DATA:')) {
			// Process sensor data directly
			handleSensorData(data);
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
		// Extract and clean the data portion
		let cleanData = '';
		if (data.startsWith('DATA:QUAT_DATA:')) {
			cleanData = data.substring('DATA:QUAT_DATA:'.length).trim();
		} else if (data.startsWith('QUAT_DATA:')) {
			cleanData = data.substring('QUAT_DATA:'.length).trim();
		} else if (data.startsWith('DATA:')) {
			// Try to find QUAT_DATA in the remaining string
			const qIndex = data.indexOf('QUAT_DATA:', 5);
			if (qIndex !== -1) {
				cleanData = data.substring(qIndex + 'QUAT_DATA:'.length).trim();
			} else {
				return; // Not a sensor data packet
			}
		}

		if (!cleanData) return;

		// Parse the data with the optimized non-regex method
		const sensorData = parseSensorData(cleanData);

		// Only broadcast if we have valid data (performance optimization)
		const sensorCount = Object.keys(sensorData).filter((k) => k.startsWith('S')).length;

		if (sensorCount > 0 || sensorData.sequence !== undefined) {
			// Create a timestamp when we process the data (not when we send it)
			const timestamp = Date.now();

			// Immediate broadcast without additional processing
			broadcast({
				type: 'sensorData',
				data: {
					timestamp: timestamp,
					sensorData: sensorData
				}
			});
		}
	} catch (error) {
		// Only log errors in sensor processing, don't disrupt the data flow
		console.error('Error processing sensor data:', error);
	}
}

/**
 * Parse quaternion sensor data
 * @param {string} data - Raw sensor data string
 * @returns {Object} - Parsed sensor data
 */
function parseSensorData(data) {
	const result = {};

	try {
		// Extract sequence number
		if (data.includes('SEQ:')) {
			const seqPart = data.substring(data.indexOf('SEQ:') + 4);
			const seqEnd = seqPart.indexOf(',');
			if (seqEnd > 0) {
				result.sequence = parseInt(seqPart.substring(0, seqEnd), 10);
			}
		}

		// Extract sensor data efficiently
		let currentPos = 0;
		while ((currentPos = data.indexOf('S', currentPos)) !== -1) {
			// Fast check for sensor pattern
			if (currentPos + 1 >= data.length || !isDigit(data[currentPos + 1])) {
				currentPos++;
				continue;
			}

			// Find sensor format S0:[w,x,y,z]
			const sensorIdEnd = data.indexOf(':', currentPos);
			if (sensorIdEnd === -1) break;

			const sensorId = data.substring(currentPos + 1, sensorIdEnd);

			const valuesStart = data.indexOf('[', sensorIdEnd);
			if (valuesStart === -1) break;

			const valuesEnd = data.indexOf(']', valuesStart);
			if (valuesEnd === -1) break;

			const valuesStr = data.substring(valuesStart + 1, valuesEnd);
			const values = fastSplit(valuesStr).map(parseFloat);

			if (values.length === 4) {
				result[`S${sensorId}`] = values;
			}

			currentPos = valuesEnd + 1;
		}
	} catch (err) {
		// Silent error handling to keep performance high
	}

	return result;
}

/**
 * Fast check if character is a digit - more efficient than regex
 * @param {string} char - Single character to check
 * @returns {boolean} - True if digit
 */
function isDigit(char) {
	return char >= '0' && char <= '9';
}

/**
 * Optimized string split for comma-separated values
 * @param {string} str - String to split
 * @returns {Array} - Array of values
 */
function fastSplit(str) {
	const result = [];
	let start = 0;
	let pos = 0;

	while (pos < str.length) {
		if (str[pos] === ',') {
			result.push(str.substring(start, pos));
			start = pos + 1;
		}
		pos++;
	}

	// Add the last part
	if (start < str.length) {
		result.push(str.substring(start));
	}

	return result;
}
