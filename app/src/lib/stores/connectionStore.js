// Connection state store
import { writable, derived } from 'svelte/store';

// Core connection state
export const connected = writable(false);
export const connecting = writable(false);
export const serialPort = writable('');
export const availablePorts = writable([]);
export const portChangeDetected = writable(false);
export const originalPort = writable('');
export const loadingPorts = writable(false);

// Streaming state
export const isStreaming = writable(false);
export const dataPacketsReceived = writable(0);
export const lastDataTimestamp = writable(0);
export const streamingRate = writable(0);

// Data storage
export const sensorData = writable({});

// Log storage
export const logs = writable([]);

// Derived values
export const canConnect = derived(
	[connected, connecting, serialPort],
	([$connected, $connecting, $serialPort]) => !$connected && !$connecting && $serialPort !== ''
);

export const canDisconnect = derived(
	[connected, connecting],
	([$connected, $connecting]) => $connected && !$connecting
);

// Connection state actions
export function setConnected(status) {
	connected.set(status);
}

export function setConnecting(status) {
	connecting.set(status);
}

export function setSerialPort(port) {
	serialPort.set(port);
}

export function setAvailablePorts(ports) {
	availablePorts.set(ports);
}

export function setPortChangeDetected(detected, newPort = null) {
	portChangeDetected.set(detected);
	if (newPort) {
		serialPort.set(newPort);
	}
}

export function setOriginalPort(port) {
	originalPort.set(port);
}

export function setLoadingPorts(loading) {
	loadingPorts.set(loading);
}

// Streaming state actions
export function setStreaming(status) {
	isStreaming.set(status);
}

export function incrementPacketCount() {
	dataPacketsReceived.update((count) => count + 1);
}

export function resetPacketCount() {
	dataPacketsReceived.set(0);
}

export function setLastDataTimestamp(timestamp) {
	lastDataTimestamp.set(timestamp);
}

export function setStreamingRate(rate) {
	streamingRate.set(rate);
}

// Log actions
export function addLog(message, level = '') {
	const prefix = level ? `[${level}] ` : '';
	logs.update((currentLogs) => {
		const newLog = {
			timestamp: new Date(),
			message: prefix + message
		};

		// Keep logs at a reasonable size
		const updatedLogs = [...currentLogs, newLog];
		if (updatedLogs.length > 1000) {
			return updatedLogs.slice(-1000);
		}
		return updatedLogs;
	});
}

export function clearLogs() {
	logs.set([]);
}
