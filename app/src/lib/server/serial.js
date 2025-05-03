// Consolidated serial port management
import { SerialPort } from 'serialport';
import { broadcast } from './webSocket.js';

global.serialPort = null;
global.originalPortPath = null;
global.lastBaudRate = 115200;
let portMonitorInterval = null;

// Buffer for accumulating partial packets
let dataBuffer = Buffer.alloc(0);

let debugLogging = false;

export function setDebugLogging(enabled) {
	debugLogging = enabled;
	console.log(`Debug logging ${enabled ? 'enabled' : 'disabled'}`);
}

// Buffer to collect partial QUAT_ messages
let quatBuffer = '';

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

function handleSerialChunk(chunk) {
	dataBuffer = Buffer.concat([dataBuffer, chunk]);

	processBuffer();
}

function processBuffer() {
	let processedUpTo = 0;

	// Process DATA: packets
	while (true) {
		const dataStart = dataBuffer.indexOf('DATA:', processedUpTo);
		if (dataStart === -1) break;

		const nextDataStart = dataBuffer.indexOf('DATA:', dataStart + 5);
		if (nextDataStart === -1) break;

		const packet = dataBuffer.slice(dataStart + 5, nextDataStart);
		processSensorDataPacket(packet);
		processedUpTo = nextDataStart;
	}

	// Handle QUAT_ and SEQ: packets
	if (processedUpTo === 0) {
		const seqStart = dataBuffer.indexOf('SEQ:');
		if (seqStart !== -1) {
			const nextSeqStart = dataBuffer.indexOf('SEQ:', seqStart + 4);
			if (nextSeqStart !== -1) {
				const packet = dataBuffer.slice(seqStart, nextSeqStart);
				processSensorDataPacket(packet);
				processedUpTo = nextSeqStart;
			}
		}

		const quatStart = dataBuffer.indexOf('QUAT_');
		if (quatStart !== -1 && (seqStart === -1 || quatStart < seqStart)) {
			if (quatStart + 5 >= dataBuffer.length || dataBuffer.indexOf('SEQ:', quatStart) === -1) {
				const packet = dataBuffer.slice(quatStart, quatStart + 5);
				processSensorDataPacket(packet);
				processedUpTo = quatStart + 5;
			} else {
				const nextQuat = dataBuffer.indexOf('QUAT_', quatStart + 5);
				const endPos = nextQuat !== -1 ? nextQuat : dataBuffer.length;
				const packet = dataBuffer.slice(quatStart, endPos);
				processSensorDataPacket(packet);
				processedUpTo = endPos;
			}
		}
	}

	// Process LOG: messages with improved multi-line handling
	while (true) {
		const logStart = dataBuffer.indexOf('LOG:', processedUpTo);
		if (logStart === -1) break;

		// Instead of looking for just any newline, we need to find where this log
		// message truly ends - at the next LOG: or DATA: that starts a new line
		let logEnd = dataBuffer.length; // Default to end of buffer

		// Search for the next LOG: or DATA: that's at the beginning of a line
		for (let pos = logStart + 4; pos < dataBuffer.length; pos++) {
			// Check if this position could be the start of a new log
			if (
				(dataBuffer[pos] === 'L'.charCodeAt(0) &&
					pos + 3 < dataBuffer.length &&
					dataBuffer[pos + 1] === 'O'.charCodeAt(0) &&
					dataBuffer[pos + 2] === 'G'.charCodeAt(0) &&
					dataBuffer[pos + 3] === ':'.charCodeAt(0)) ||
				(dataBuffer[pos] === 'D'.charCodeAt(0) &&
					pos + 4 < dataBuffer.length &&
					dataBuffer[pos + 1] === 'A'.charCodeAt(0) &&
					dataBuffer[pos + 2] === 'T'.charCodeAt(0) &&
					dataBuffer[pos + 3] === 'A'.charCodeAt(0) &&
					dataBuffer[pos + 4] === ':'.charCodeAt(0))
			) {
				// Only consider it a log boundary if it's at the start of a line
				// Check if it's preceded by a newline or is at the beginning
				if (pos === 0 || dataBuffer[pos - 1] === '\n'.charCodeAt(0)) {
					logEnd = pos;
					break;
				}
			}
		}

		// If we couldn't find a definite end and the buffer is getting large,
		// process what we have so far to avoid memory issues
		if (logEnd === dataBuffer.length && logEnd - logStart > 10000) {
			logEnd = logStart + 10000; // Process 10KB chunks at most
		}

		// If we still don't have a definite end, wait for more data
		if (logEnd === dataBuffer.length) {
			break;
		}

		const logMessage = dataBuffer
			.slice(logStart + 4, logEnd)
			.toString()
			.trim();

		if (logMessage) {
			broadcast({
				type: 'log',
				message: logMessage
			});
		}

		processedUpTo = logEnd;
	}

	if (processedUpTo > 0) {
		dataBuffer = dataBuffer.slice(processedUpTo);
	}

	// Safety limit for buffer size
	if (dataBuffer.length > 10000) {
		console.warn(`Data buffer too large (${dataBuffer.length} bytes), truncating`);
		dataBuffer = dataBuffer.slice(dataBuffer.length - 1000);
	}
}

function processSensorDataPacket(packet) {
	try {
		const data = packet.toString().trim();

		if (!data) return;

		if (data === 'QUAT_') {
			quatBuffer = data;
			return;
		}

		let processedData = data;
		if (quatBuffer === 'QUAT_' && data.startsWith('SEQ:')) {
			processedData = quatBuffer + data;
			quatBuffer = '';
		}

		if (processedData.includes('QUAT_DATA:') || processedData.includes('SEQ:')) {
			const cleanData = extractQuatData(processedData);
			if (cleanData) {
				const sensorData = parseSensorData(cleanData);
				const sensorCount = Object.keys(sensorData).filter((k) => k.startsWith('S')).length;

				if (sensorCount > 0 || sensorData.sequence !== undefined) {
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

					return;
				}
			}
		}

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
	return data;
}

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

export function stopPortMonitoring() {
	if (portMonitorInterval) {
		clearInterval(portMonitorInterval);
		portMonitorInterval = null;
	}
}

export async function listSerialPorts() {
	try {
		return await SerialPort.list();
	} catch (error) {
		console.error('Error listing serial ports:', error);
		throw error;
	}
}

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
