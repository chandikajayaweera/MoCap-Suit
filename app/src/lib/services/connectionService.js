// Client-side connection management
import {
	setConnected,
	setConnecting,
	setStreaming,
	resetPacketCount,
	addLog,
	setLastDataTimestamp,
	setPortChangeDetected,
	setOriginalPort,
	serialPort,
	sensorData,
	lastDataTimestamp,
	isStreaming
} from '../stores/connectionStore.js';

import { updateSensorData } from '../stores/motionStore.js';
import { parseDataMessage, trackDataReception } from './dataService.js';

let socket = null;
let animFrameId = null;
let reconnectTimer = null;
let heartbeatInterval = null;
let lastHeartbeatResponse = 0;

/**
 * Connect to serial port
 */
export async function connect(port, baudRate = 115200) {
	if (!port) {
		throw new Error('Port is required');
	}

	setConnecting(true);
	setOriginalPort(port);
	setPortChangeDetected(false);

	try {
		const response = await fetch('/api/connect', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				port,
				baudRate,
				dtrControl: false
			})
		});

		const data = await response.json();

		if (data.success) {
			setConnected(true);
			initWebSocket();
			return true;
		} else {
			throw new Error(data.error || 'Connection failed');
		}
	} finally {
		setConnecting(false);
	}
}

/**
 * Disconnect from serial port
 */
export async function disconnect() {
	// Check if streaming is active, send stop command first
	try {
		const streamingActive = await isStreamingActive();
		if (streamingActive) {
			console.log('Streaming is active, sending stop command before disconnecting');
			await sendCommand('X');

			// Give a short delay for the stop command to take effect
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	} catch (error) {
		console.warn('Error checking streaming status:', error);
		// Continue with disconnect anyway
	}

	// Now perform the actual disconnect
	cleanupWebSocket();

	const response = await fetch('/api/disconnect', { method: 'POST' });
	const data = await response.json();

	if (data.success) {
		setConnected(false);
		setStreaming(false);
		resetPacketCount();
		setPortChangeDetected(false);
		return true;
	} else {
		throw new Error(data.error || 'Disconnect failed');
	}
}

/**
 * Check if streaming is currently active
 */
async function isStreamingActive() {
	let streamingState = false;

	// We'll use a combination of checking the store and a direct API check if needed
	const unsubscribe = isStreaming.subscribe((value) => {
		streamingState = value;
	});
	unsubscribe();

	return streamingState;
}

/**
 * Initialize WebSocket connection
 */
export function initWebSocket() {
	cleanupWebSocket();

	if (socket && socket.readyState !== WebSocket.CLOSED) {
		console.warn('WebSocket connection already exists');
		return;
	}

	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const wsUrl = `${protocol}//${window.location.host}/api/ws`;

	console.log(`Connecting to WebSocket at ${wsUrl}`);

	try {
		socket = new WebSocket(wsUrl);
		socket.binaryType = 'arraybuffer';

		const connectionTimeout = setTimeout(() => {
			if (socket && socket.readyState !== WebSocket.OPEN) {
				console.warn('WebSocket connection timeout');
				cleanupWebSocket();
				scheduleReconnect(3000);
			}
		}, 10000);

		socket.onopen = () => {
			console.log('WebSocket connected');
			clearTimeout(connectionTimeout);
			addLog('WebSocket connection established');

			// Reset reconnect attempts
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}

			// Start heartbeat
			startHeartbeat();

			// Configure WebSocket for real-time
			socket.send(
				JSON.stringify({
					type: 'config',
					settings: {
						noDelay: true,
						binaryType: 'arraybuffer'
					}
				})
			);
		};

		socket.onmessage = handleWebSocketMessage;

		socket.onerror = (error) => {
			console.error('WebSocket error:', error);
			addLog('WebSocket error occurred', 'ERROR');
		};

		socket.onclose = (event) => {
			console.log(`WebSocket closed (code: ${event.code}, reason: ${event.reason})`);

			// Clean up heartbeat
			if (heartbeatInterval) {
				clearInterval(heartbeatInterval);
				heartbeatInterval = null;
			}

			// Schedule reconnect if not intentionally closed
			if (event.code !== 1000) {
				scheduleReconnect();
			}
		};
	} catch (error) {
		console.error('Failed to create WebSocket:', error);
		addLog(`WebSocket connection error: ${error.message}`, 'ERROR');
		socket = null;
		scheduleReconnect();
	}
}

/**
 * Schedule WebSocket reconnection
 */
function scheduleReconnect(delay = 5000) {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
	}

	reconnectTimer = setTimeout(() => {
		console.log('Attempting to reconnect WebSocket...');
		initWebSocket();
	}, delay);
}

/**
 * Start heartbeat to keep connection alive
 */
function startHeartbeat() {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
	}

	lastHeartbeatResponse = Date.now();

	heartbeatInterval = setInterval(() => {
		if (socket && socket.readyState === WebSocket.OPEN) {
			// Check if we've received a response to previous ping
			const now = Date.now();
			if (now - lastHeartbeatResponse > 30000) {
				console.warn('No heartbeat response - reconnecting');
				cleanupWebSocket();
				initWebSocket();
				return;
			}

			// Send heartbeat
			socket.send(
				JSON.stringify({
					type: 'ping',
					timestamp: now
				})
			);
		}
	}, 15000); // 15 seconds
}

/**
 * Handle WebSocket messages
 */
function handleWebSocketMessage(event) {
	try {
		// Parse JSON data
		let data;
		try {
			data = JSON.parse(event.data);
		} catch (e) {
			console.error('Error parsing WebSocket message:', e);
			return;
		}

		// Update heartbeat timestamp on any message
		lastHeartbeatResponse = Date.now();

		// Process different message types
		if (data.type === 'sensorData') {
			processSensorData(data);
		} else if (data.type === 'log') {
			processLogMessage(data);
		} else if (data.type === 'pong') {
			// Silent - already updated lastHeartbeatResponse
		}
	} catch (error) {
		console.error('Error handling WebSocket message:', error);
	}
}

/**
 * Process sensor data from WebSocket
 */
function processSensorData(data) {
	try {
		// Extract sensor data from various possible formats
		let extractedData;

		if (data.data && data.data.sensorData) {
			extractedData = data.data.sensorData;
		} else if (data.data) {
			extractedData = data.data;
		} else if (data.sensorData) {
			extractedData = data.sensorData;
		} else {
			extractedData = data;
		}

		// Verify we have actual sensor data
		const sensorKeys = Object.keys(extractedData).filter((k) => k.startsWith('S'));
		if (sensorKeys.length === 0) {
			if (extractedData.sequence !== undefined) {
				console.log('Has sequence number but no sensor data:', extractedData.sequence);
			}
			return;
		}

		// Only log for significant sequence milestones
		if (extractedData.sequence % 50 === 0) {
			console.log(
				`Sensor data received: ${sensorKeys.length} sensors, sequence: ${extractedData.sequence}`
			);
		}

		// Update streaming state
		setStreaming(true);

		// Track data reception for statistics
		trackDataReception(extractedData);

		// Update timestamp
		setLastDataTimestamp(Date.now());

		// CRITICAL FIX: Create a clean copy of the data for stores
		// This ensures we're passing the exact same data structure to both stores
		const cleanData = {
			sequence: extractedData.sequence || 0,
			timestamp: Date.now() // Add timestamp for tracking
		};

		// Copy sensor data - ensuring we have only valid quaternions
		for (const key of sensorKeys) {
			const sensorData = extractedData[key];
			if (
				Array.isArray(sensorData) &&
				sensorData.length === 4 &&
				sensorData.every((v) => typeof v === 'number' && !isNaN(v))
			) {
				cleanData[key] = [...sensorData]; // Create a copy of the array
			}
		}

		// Update both stores with consistent data
		sensorData.set(cleanData);
		updateSensorData(cleanData);
	} catch (error) {
		console.error('Error processing sensor data:', error);
	}
}

/**
 * Process log message from WebSocket
 */
function processLogMessage(data) {
	if (!data.message) return;

	// CRITICAL FIX: Always add logs to the store first
	addLog(data.message);

	// Then do other processing
	if (data.message.includes('reconnected to new port')) {
		handlePortChange(data.message);
	}

	// Detect streaming status from logs
	if (
		data.message.includes('Sensor reading started') ||
		data.message.includes('UDP server started for sensor data') ||
		data.message.includes('UDP data streaming started')
	) {
		setStreaming(true);
		setLastDataTimestamp(Date.now());
	} else if (
		data.message.includes('Sensor reading stopped') ||
		data.message.includes('UDP server stopped') ||
		data.message.includes('stopped.') ||
		data.message.includes('not running') ||
		data.message.includes('Command sent: X')
	) {
		setStreaming(false);
	}

	// Process QUAT_DATA in logs only if not getting direct sensor messages
	const now = Date.now();
	let lastTimestamp = 0;

	const unsubscribe = lastDataTimestamp.subscribe((value) => {
		lastTimestamp = value;
	});
	unsubscribe();

	const timeSinceLastData = now - lastTimestamp;

	if (data.message.includes('QUAT_DATA:') && timeSinceLastData > 100) {
		const parsedData = parseDataMessage(data.message);
		if (parsedData) {
			trackDataReception(parsedData);
			setLastDataTimestamp(now);

			// Update both stores
			sensorData.set(parsedData);
			updateSensorData(parsedData);

			// Log the parsed data
			console.log(
				'Parsed QUAT_DATA from log:',
				Object.keys(parsedData).filter((k) => k.startsWith('S')).length,
				'sensors, sequence:',
				parsedData.sequence
			);
		}
	}
}

/**
 * Handle port change notification
 */
function handlePortChange(message) {
	const match = message.match(/new port ([^ ]+)/);
	if (match && match[1]) {
		const newPort = match[1];
		let currentPort = '';

		const unsubscribe = serialPort.subscribe((value) => {
			currentPort = value;
		});
		unsubscribe();

		if (currentPort !== newPort) {
			setPortChangeDetected(true, newPort);
			addLog(
				`Device has reconnected on port ${newPort} (was ${currentPort}). Port selection has been updated.`
			);

			// Refresh port list in UI
			setTimeout(() => {
				loadAvailablePorts();
			}, 1000);
		}
	}
}

/**
 * Clean up WebSocket connection
 */
function cleanupWebSocket() {
	// Clear any intervals
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
		heartbeatInterval = null;
	}

	if (socket) {
		// Remove all event listeners
		socket.onopen = null;
		socket.onmessage = null;
		socket.onclose = null;
		socket.onerror = null;

		// Close connection if open
		if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
			try {
				// Use 1000 (normal closure) for intentional disconnects
				socket.close(1000, 'Intentional disconnect');
			} catch (e) {
				console.error('Error closing socket during cleanup:', e);
			}
		}
		socket = null;
	}
}

/**
 * Send command via WebSocket
 */
export function sendCommand(command) {
	if (!socket || socket.readyState !== WebSocket.OPEN) {
		console.error('Cannot send command: WebSocket not connected');
		return false;
	}

	// Update UI state for immediate feedback
	if (command === 'S') {
		setStreaming(true);
		resetPacketCount();
		setLastDataTimestamp(Date.now());
		addLog('Sending command to start streaming...', 'INFO');
	} else if (command === 'X') {
		setStreaming(false);
		addLog('Sending command to stop streaming...', 'INFO');
	}

	try {
		socket.send(
			JSON.stringify({
				type: 'command',
				command: command
			})
		);

		addLog(`Sent command: ${command}`);
		return true;
	} catch (error) {
		console.error('Error sending command:', error);
		addLog(`Failed to send command: ${error.message}`, 'ERROR');
		return false;
	}
}

/**
 * Load available serial ports
 */
export async function loadAvailablePorts() {
	const response = await fetch('/api/ports');
	const data = await response.json();

	if (data.success && data.ports) {
		return data.ports;
	} else {
		throw new Error(data.error || 'Failed to get ports');
	}
}

/**
 * Schedule visualization update using requestAnimationFrame
 */
function scheduleVisualUpdate() {
	if (!animFrameId) {
		animFrameId = requestAnimationFrame(() => {
			animFrameId = null;
		});
	}
}

/**
 * Update both stores with clean sensor data
 */
export function syncSensorData(data) {
	if (!data) return;

	// Create copy of data to ensure stores don't share references
	const cleanData = { ...data };

	// Update connectionStore
	sensorData.set(cleanData);

	// Update motionStore
	updateSensorData(cleanData);
}
