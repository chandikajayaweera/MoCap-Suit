// Motion capture data and application state store
import { writable, derived } from 'svelte/store';

// Core application state
export const connected = writable(false);
export const sensorData = writable({});

// Visualization settings
export const selectedModel = writable('basic');
export const selectedEnvironment = writable('studio');
export const showSkeleton = writable(false);
export const debugMode = writable(false);

// Loading state
export const loading = writable(false);

// Derived values for UI
export const isStreaming = derived(
	[connected, sensorData],
	([$connected, $sensorData]) => $connected && Object.keys($sensorData).length > 0
);

// Action to update sensor data
export function updateSensorData(newData) {
	sensorData.set(newData);
}

// Action to toggle connection
export function setConnected(status) {
	connected.set(status);
}

// Actions for model settings
export function selectModel(modelId) {
	selectedModel.set(modelId);
}

export function selectEnvironment(envId) {
	selectedEnvironment.set(envId);
}

export function toggleSkeleton() {
	showSkeleton.update((value) => !value);
}

export function setLoading(isLoading) {
	loading.set(isLoading);
}

// Debug helpers
export function toggleDebug() {
	debugMode.update((value) => {
		const newValue = !value;

		// Log current state when debug mode is activated
		if (newValue) {
			console.log('Debug mode activated');
			connected.subscribe((value) => console.log('Connected:', value));
			selectedModel.subscribe((value) => console.log('Selected model:', value));
			selectedEnvironment.subscribe((value) => console.log('Selected environment:', value));
			showSkeleton.subscribe((value) => console.log('Show skeleton:', value));
			sensorData.subscribe((value) => console.log('Sensor count:', Object.keys(value).length));
		}

		return newValue;
	});
}

export function logDebug(message, data) {
	let isDebug = false;
	const unsubscribe = debugMode.subscribe((value) => {
		isDebug = value;
	});

	if (isDebug) {
		console.log(`[DEBUG] ${message}`, data);
	}

	unsubscribe();
}
