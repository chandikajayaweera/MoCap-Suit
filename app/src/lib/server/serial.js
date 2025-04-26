// Consolidated serial port management
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { broadcast } from './webSocket.js';

// Store global references
global.serialPort = null;
global.parser = null;
global.originalPortPath = null;
global.lastBaudRate = 115200;
let portMonitorInterval = null;

/**
 * Connect to serial port
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

		global.serialPort = new SerialPort({
			path: options.port,
			baudRate: global.lastBaudRate,
			autoOpen: false,
			rtscts: false,
			xon: false,
			xoff: false,
			hupcl: false,
			highWaterMark: 64
		});

		return new Promise((resolve, reject) => {
			global.serialPort.open((error) => {
				if (error) {
					console.error('Error opening serial port:', error);
					reject(error);
					return;
				}

				console.log('Serial port opened successfully');

				// Prevent device reset
				setTimeout(() => {
					try {
						if (global.serialPort && global.serialPort.isOpen) {
							global.serialPort.set({ dtr: false, rts: false, brk: false });
						}
					} catch (err) {
						console.warn('Could not set DTR/RTS signals:', err);
					}
				}, 100);

				// Create parser with clear error handling
				global.parser = global.serialPort.pipe(
					new ReadlineParser({
						delimiter: '\n',
						encoding: 'utf8',
						includeDelimiter: false
					})
				);

				// Ensure we handle data immediately
				global.parser.on('data', (data) => {
					// Use process.nextTick for better async performance
					process.nextTick(() => handleSerialData(data));
				});

				// Handle errors with proper logging
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
					message: `[INFO] Connected to ${options.port} at ${global.lastBaudRate} baud`
				});

				// Start port monitoring
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
 * Disconnect from serial port
 */
export async function disconnectFromSerialPort() {
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
 * Check if the port has changed and update accordingly
 */
async function checkForPortChange() {
	if (!global.serialPort || !global.serialPort.isOpen || !global.originalPortPath) {
		return null;
	}

	try {
		const ports = await SerialPort.list();
		const currentPortExists = ports.some((p) => p.path === global.serialPort.path);

		if (!currentPortExists) {
			console.log(
				`Current port ${global.serialPort.path} no longer found. Looking for relocated device...`
			);

			// Find port with similar characteristics
			const originalPortInfo = ports.find((p) => p.path === global.originalPortPath);

			if (!originalPortInfo) {
				const possiblePorts = ports.filter(
					(p) =>
						(p.manufacturer &&
							(p.manufacturer.includes('Silicon Labs') || p.manufacturer.includes('Espressif'))) ||
						(p.vendorId === '10c4' && p.productId === 'ea60') ||
						(p.vendorId === '1a86' && p.productId === '7523')
				);

				if (possiblePorts.length === 1) {
					return possiblePorts[0].path;
				} else if (possiblePorts.length > 1) {
					possiblePorts.sort((a, b) => {
						const numA = parseInt(a.path.replace(/\D/g, '')) || 0;
						const numB = parseInt(b.path.replace(/\D/g, '')) || 0;
						return numA - numB;
					});
					return possiblePorts[0].path;
				}
			} else {
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
	} catch (_) {
		// Fixed: Unused variable renamed to _
		console.error('Error checking for port change');
	}

	return null;
}

/**
 * Start monitoring for port changes
 */
export function startPortMonitoring() {
	if (portMonitorInterval || !global.serialPort || !global.serialPort.isOpen) {
		return;
	}

	console.log('Starting port monitoring...');

	portMonitorInterval = setInterval(async () => {
		if (global.serialPort && global.serialPort.isOpen) {
			const newPort = await checkForPortChange();

			if (newPort) {
				console.log(`Device reconnected on new port: ${newPort}. Attempting to reconnect...`);
				await disconnectFromSerialPort();
				await new Promise((resolve) => setTimeout(resolve, 1500));

				try {
					await connectToSerialPort({
						port: newPort,
						baudRate: global.lastBaudRate,
						dtrControl: false
					});

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
 */
export async function listSerialPorts() {
	try {
		return await SerialPort.list();
	} catch (error) {
		console.error('Error listing serial ports:', error);
		throw error;
	}
}

/**
 * Send command to serial port
 */
export function sendCommand(command) {
	if (!global.serialPort || !global.serialPort.isOpen) {
		console.error('Cannot send command: Port not open');
		return false;
	}

	try {
		global.serialPort.write(command + '\n');
		console.log(`Command sent to serial port: ${command}`);

		broadcast({
			type: 'log',
			message: `[INFO] Command sent: ${command}`
		});

		return true;
	} catch (error) {
		console.error('Error sending command:', error);
		broadcast({
			type: 'log',
			message: `[ERROR] Failed to send command: ${error.message}`
		});
		return false;
	}
}

/**
 * Handle data received from serial port
 */
function handleSerialData(data) {
	// Debug logging for troubleshooting
	console.log(`Raw serial data received: ${data.substring(0, 50)}...`);

	try {
		if (data.startsWith('DATA:')) {
			// Process sensor data
			handleSensorData(data.substring(5));
		} else if (data.startsWith('LOG:')) {
			// Log that we're broadcasting a log message
			console.log(`Broadcasting log: ${data.substring(4)}`);

			// Process log message
			broadcast({
				type: 'log',
				message: data.substring(4)
			});
		} else {
			// Unknown format, treat as log
			console.log(`Broadcasting unknown data type: ${data}`);
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
 */
function handleSensorData(data) {
	try {
		let cleanData = '';

		if (data.startsWith('QUAT_DATA:')) {
			cleanData = data.substring('QUAT_DATA:'.length).trim();
		} else if (data.indexOf('QUAT_DATA:') !== -1) {
			const index = data.indexOf('QUAT_DATA:');
			cleanData = data.substring(index + 'QUAT_DATA:'.length).trim();
		} else {
			return;
		}

		if (!cleanData) return;

		const sensorData = parseSensorData(cleanData);
		const sensorCount = Object.keys(sensorData).filter((k) => k.startsWith('S')).length;

		if (sensorCount > 0 || sensorData.sequence !== undefined) {
			// Log that we're broadcasting sensor data
			console.log(
				`Broadcasting sensor data with ${sensorCount} sensors, seq: ${sensorData.sequence}`
			);

			broadcast({
				type: 'sensorData',
				data: {
					timestamp: Date.now(),
					sensorData: sensorData
				}
			});
		}
	} catch (error) {
		console.error('Error processing sensor data:', error);
	}
}

/**
 * Parse quaternion sensor data
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

		// Extract sensor data
		let currentPos = 0;
		while ((currentPos = data.indexOf('S', currentPos)) !== -1) {
			if (currentPos + 1 >= data.length || !isDigit(data[currentPos + 1])) {
				currentPos++;
				continue;
			}

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
	} catch (_) {
		// Fixed: Unused variable renamed to _
		// Silent error handling to avoid crashes
	}

	return result;
}

/**
 * Check if character is a digit
 */
function isDigit(char) {
	return char >= '0' && char <= '9';
}

/**
 * Fast string split for comma-separated values
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

	if (start < str.length) {
		result.push(str.substring(start));
	}

	return result;
}
