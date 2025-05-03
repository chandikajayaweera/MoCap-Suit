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

export async function disconnect() {
	try {
		const streamingActive = await isStreamingActive();
		if (streamingActive) {
			console.log('Streaming is active, sending stop command before disconnecting');
			await sendCommand('X');

			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	} catch (error) {
		console.warn('Error checking streaming status:', error);
	}

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

async function isStreamingActive() {
	let streamingState = false;

	const unsubscribe = isStreaming.subscribe((value) => {
		streamingState = value;
	});
	unsubscribe();

	return streamingState;
}

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

			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}

			startHeartbeat();

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

			if (heartbeatInterval) {
				clearInterval(heartbeatInterval);
				heartbeatInterval = null;
			}

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

function scheduleReconnect(delay = 5000) {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
	}

	reconnectTimer = setTimeout(() => {
		console.log('Attempting to reconnect WebSocket...');
		initWebSocket();
	}, delay);
}

function startHeartbeat() {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
	}

	lastHeartbeatResponse = Date.now();

	heartbeatInterval = setInterval(() => {
		if (socket && socket.readyState === WebSocket.OPEN) {
			const now = Date.now();
			if (now - lastHeartbeatResponse > 30000) {
				console.warn('No heartbeat response - reconnecting');
				cleanupWebSocket();
				initWebSocket();
				return;
			}

			socket.send(
				JSON.stringify({
					type: 'ping',
					timestamp: now
				})
			);
		}
	}, 15000);
}

function handleWebSocketMessage(event) {
	try {
		const data = JSON.parse(event.data);

		lastHeartbeatResponse = Date.now();

		if (data.type === 'sensorData') {
			processSensorData(data);
		} else if (data.type === 'log') {
			processLogMessage(data);
		} else if (data.type === 'pong') {
			// Silent - already updated lastHeartbeatResponse
		}
	} catch (error) {
		console.error('Error parsing WebSocket message:', error);
	}
}

function processSensorData(data) {
	try {
		console.log('Processing sensor data:', data?.data?.sensorData?.sequence || 'unknown sequence');

		let extractedData;
		if (data.data && data.data.sensorData) {
			extractedData = data.data.sensorData;
		} else if (data.data) {
			extractedData = data.data;
		} else {
			extractedData = data;
		}

		if (extractedData && typeof extractedData === 'object') {
			const sensorCount = Object.keys(extractedData).filter((k) => k.startsWith('S')).length;

			console.log(
				'Valid sensor data found:',
				sensorCount,
				'sensors, sequence:',
				extractedData.sequence
			);

			setStreaming(true);

			trackDataReception(extractedData);

			setLastDataTimestamp(Date.now());

			sensorData.set(extractedData);

			updateSensorData(extractedData);

			scheduleVisualUpdate();
		} else {
			console.warn('Invalid sensor data structure:', extractedData);
		}
	} catch (error) {
		console.error('Error processing sensor data:', error);
	}
}

function processLogMessage(data) {
	if (!data.message) return;

	addLog(data.message);

	if (data.message.includes('reconnected to new port')) {
		handlePortChange(data.message);
	}

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

			sensorData.set(parsedData);
			updateSensorData(parsedData);

			console.log(
				'Parsed QUAT_DATA from log:',
				Object.keys(parsedData).filter((k) => k.startsWith('S')).length,
				'sensors, sequence:',
				parsedData.sequence
			);
		}
	}
}

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

			setTimeout(() => {
				loadAvailablePorts();
			}, 1000);
		}
	}
}

function cleanupWebSocket() {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
		heartbeatInterval = null;
	}

	if (socket) {
		socket.onopen = null;
		socket.onmessage = null;
		socket.onclose = null;
		socket.onerror = null;

		if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
			try {
				socket.close(1000, 'Intentional disconnect');
			} catch (e) {
				console.error('Error closing socket during cleanup:', e);
			}
		}
		socket = null;
	}
}

export function sendCommand(command) {
	if (!socket || socket.readyState !== WebSocket.OPEN) {
		console.error('Cannot send command: WebSocket not connected');
		return false;
	}

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

export async function loadAvailablePorts() {
	const response = await fetch('/api/ports');
	const data = await response.json();

	if (data.success && data.ports) {
		return data.ports;
	} else {
		throw new Error(data.error || 'Failed to get ports');
	}
}

function scheduleVisualUpdate() {
	if (!animFrameId) {
		animFrameId = requestAnimationFrame(() => {
			animFrameId = null;
		});
	}
}
