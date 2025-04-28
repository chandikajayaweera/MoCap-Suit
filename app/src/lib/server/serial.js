// Consolidated serial port management
import { SerialPort } from 'serialport';
import { broadcast } from './webSocket.js';

// Store global references
global.serialPort = null;
global.originalPortPath = null;
global.lastBaudRate = 115200;
let portMonitorInterval = null;

// Buffer for accumulating partial packets
let dataBuffer = Buffer.alloc(0);

let debugLogging = false;

/**
 * Enable or disable debug logging
 */
export function setDebugLogging(enabled) {
	debugLogging = enabled;
	console.log(`Debug logging ${enabled ? 'enabled' : 'disabled'}`);
}

// Buffer to collect partial QUAT_ messages
let quatBuffer = '';

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

				// Reset data buffer
				dataBuffer = Buffer.alloc(0);

				// Handle raw data directly instead of using a line parser
				global.serialPort.on('data', (chunk) => {
					// Process data in the next tick for better performance
					process.nextTick(() => handleSerialChunk(chunk));
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
				dataBuffer = Buffer.alloc(0);
				resolve(true);
			});
		} else {
			global.serialPort = null;
			dataBuffer = Buffer.alloc(0);
			resolve(true);
		}
	});
}

/**
 * Handle incoming data chunk from serial port
 * This uses a buffer-based approach similar to the benchmark script
 */
function handleSerialChunk(chunk) {
	// Append new data to our buffer
	dataBuffer = Buffer.concat([dataBuffer, chunk]);

	// Process all complete packets in the buffer
	processBuffer();
}

/**
 * Process the data buffer for complete packets
 */
function processBuffer() {
	let processedUpTo = 0;

	// Process DATA packets
	while (true) {
		// Look for DATA: marker
		const dataStart = dataBuffer.indexOf('DATA:', processedUpTo);
		if (dataStart === -1) break;

		// Look for the start of the next packet
		const nextDataStart = dataBuffer.indexOf('DATA:', dataStart + 5);
		if (nextDataStart === -1) break; // Incomplete packet, wait for more data

		// Extract the complete packet
		const packet = dataBuffer.slice(dataStart + 5, nextDataStart);

		// Process the packet
		processSensorDataPacket(packet);

		// Move the processed pointer
		processedUpTo = nextDataStart;
	}

	// Handle case where we have QUAT_ or SEQ: without DATA: prefix
	if (processedUpTo === 0) {
		// Look for sequence data
		const seqStart = dataBuffer.indexOf('SEQ:');
		if (seqStart !== -1) {
			// Look for end of this packet (newline or next sequence)
			const nextSeqStart = dataBuffer.indexOf('SEQ:', seqStart + 4);

			if (nextSeqStart !== -1) {
				// We have a complete packet
				const packet = dataBuffer.slice(seqStart, nextSeqStart);
				processSensorDataPacket(packet);
				processedUpTo = nextSeqStart;
			}
		}

		// Look for QUAT_ marker
		const quatStart = dataBuffer.indexOf('QUAT_');
		if (quatStart !== -1 && (seqStart === -1 || quatStart < seqStart)) {
			// Check if it's just a QUAT_ fragment
			if (quatStart + 5 >= dataBuffer.length || dataBuffer.indexOf('SEQ:', quatStart) === -1) {
				// Just a QUAT_ fragment, process it and then wait for more
				const packet = dataBuffer.slice(quatStart, quatStart + 5);
				processSensorDataPacket(packet);
				processedUpTo = quatStart + 5;
			} else {
				// QUAT_ with SEQ data - find where it ends
				const nextQuat = dataBuffer.indexOf('QUAT_', quatStart + 5);
				const endPos = nextQuat !== -1 ? nextQuat : dataBuffer.length;
				const packet = dataBuffer.slice(quatStart, endPos);
				processSensorDataPacket(packet);
				processedUpTo = endPos;
			}
		}
	}

	// Process LOG messages
	while (true) {
		const logStart = dataBuffer.indexOf('LOG:', processedUpTo);
		if (logStart === -1) break;

		// Find the end of the log message (newline or next LOG:/DATA:)
		let logEnd = dataBuffer.indexOf('\n', logStart);
		const nextLogStart = dataBuffer.indexOf('LOG:', logStart + 4);
		const nextDataStart = dataBuffer.indexOf('DATA:', logStart + 4);

		// Choose the closest endpoint
		if (logEnd === -1) logEnd = Infinity;
		if (nextLogStart !== -1 && nextLogStart < logEnd) logEnd = nextLogStart;
		if (nextDataStart !== -1 && nextDataStart < logEnd) logEnd = nextDataStart;

		if (logEnd === Infinity) break; // No complete log message yet

		// Extract the log message
		const logMessage = dataBuffer
			.slice(logStart + 4, logEnd)
			.toString()
			.trim();

		// Process the log message
		if (logMessage) {
			broadcast({
				type: 'log',
				message: logMessage
			});
		}

		// Move the processed pointer
		processedUpTo = logEnd;
	}

	// Keep only unprocessed data in the buffer
	if (processedUpTo > 0) {
		dataBuffer = dataBuffer.slice(processedUpTo);
	}

	// If buffer is getting too large without successful processing,
	// it might indicate a protocol issue - truncate it as a safety measure
	if (dataBuffer.length > 10000) {
		console.warn(`Data buffer too large (${dataBuffer.length} bytes), truncating`);
		dataBuffer = dataBuffer.slice(dataBuffer.length - 1000);
	}
}

/**
 * Process a single sensor data packet
 */
function processSensorDataPacket(packet) {
	try {
		// Convert to string for parsing
		const data = packet.toString().trim();

		// Skip empty packets
		if (!data) return;

		// Check if this is a partial QUAT_ message
		if (data === 'QUAT_') {
			quatBuffer = data;
			return; // Wait for the rest of the message
		}

		// If we have a buffered QUAT_ prefix and current packet has SEQ data, combine them
		let processedData = data;
		if (quatBuffer === 'QUAT_' && data.startsWith('SEQ:')) {
			processedData = quatBuffer + data;
			quatBuffer = ''; // Reset buffer
		}

		// Parse packets with quaternion data
		if (processedData.includes('QUAT_DATA:') || processedData.includes('SEQ:')) {
			const cleanData = extractQuatData(processedData);
			if (cleanData) {
				const sensorData = parseSensorData(cleanData);
				const sensorCount = Object.keys(sensorData).filter((k) => k.startsWith('S')).length;

				if (sensorCount > 0 || sensorData.sequence !== undefined) {
					// Only log if debug logging is enabled or it's a milestone sequence
					if (debugLogging && sensorData.sequence % 25 === 0) {
						console.log(
							`Broadcasting sensor data with ${sensorCount} sensors, seq: ${sensorData.sequence}`
						);
					}

					broadcast({
						type: 'sensorData',
						data: {
							timestamp: Date.now(),
							sensorData: sensorData
						}
					});

					// Don't log every sensor packet to reduce system log noise
					return;
				}
			}
		}

		// If it's not sensor data or if data parse failed, treat as log
		// but only if it's not just noise
		if (processedData !== 'QUAT_' && !processedData.startsWith('SEQ:')) {
			if (debugLogging) {
				console.log(`Broadcasting unknown data: ${processedData.substring(0, 50)}...`);
			}
			broadcast({
				type: 'log',
				message: processedData
			});
		}
	} catch (error) {
		console.error('Error processing sensor packet:', error);
	}
}

/**
 * Extract quaternion data from a mixed message
 */
function extractQuatData(data) {
	if (data.startsWith('QUAT_DATA:')) {
		return data.substring('QUAT_DATA:'.length).trim();
	} else if (data.indexOf('QUAT_DATA:') !== -1) {
		const index = data.indexOf('QUAT_DATA:');
		return data.substring(index + 'QUAT_DATA:'.length).trim();
	} else if (data.startsWith('QUAT_SEQ:') || data.includes('SEQ:')) {
		// Handle the split format or direct SEQ format
		const seqIndex = data.indexOf('SEQ:');
		if (seqIndex !== -1) {
			return data.substring(seqIndex).trim();
		}
	}
	return data; // Try to parse as-is if no prefix found
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
	} catch (error) {
		console.error('Error parsing sensor data:', error);
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
	} catch (error) {
		console.error('Error checking for port change:', error);
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
