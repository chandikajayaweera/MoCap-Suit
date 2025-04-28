// Motion capture data and application state store
import { writable, derived } from 'svelte/store';

// Core application state
export const connected = writable(false);
export const sensorData = writable({});

// Visualization settings
export const selectedModel = writable('xbot'); // Change from 'basic' to 'xbot'
export const selectedEnvironment = writable('studio');
export const showSkeleton = writable(false);
export const debugMode = writable(false);

// Loading state
export const loading = writable(false);

// Subscription handler to debug mode toggle
debugMode.subscribe((value) => {
	// This will run whenever the debug mode is toggled
	console.log(`Debug mode ${value ? 'enabled' : 'disabled'}`);

	// If we're in browser environment, try to set debug logging on server
	if (typeof window !== 'undefined' && value !== undefined) {
		try {
			fetch('/api/debug', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ debug: value })
			}).catch((err) => console.error('Failed to update debug setting:', err));
		} catch (e) {
			console.error('Error setting debug mode:', e);
		}
	}
});

// Derived values for UI
export const isStreaming = derived(
	[connected, sensorData],
	([$connected, $sensorData]) => $connected && Object.keys($sensorData).length > 0
);

// Action to update sensor data
export function updateSensorData(newData) {
	if (!newData) return;

	// For debugging, occasionally log updates
	if (newData.sequence && newData.sequence % 50 === 0) {
		console.log(`Motion store updating with sequence ${newData.sequence}`);
	}

	// Important: create a new object to trigger reactivity
	sensorData.set({ ...newData });
}

// Action to toggle connection
export function setConnected(status) {
	connected.set(status);
}

// Actions for model settings
export function selectModel(modelId) {
	console.log(`Setting model to: ${modelId}`);
	selectedModel.set(modelId);
}

export function selectEnvironment(envId) {
	console.log(`Setting environment to: ${envId}`);
	selectedEnvironment.set(envId);
}

export function toggleSkeleton() {
	showSkeleton.update((current) => {
		const newValue = !current;
		console.log(`Skeleton visibility ${newValue ? 'enabled' : 'disabled'}`);
		return newValue;
	});
}

export function setLoading(isLoading) {
	loading.set(isLoading);
}

// Debug helpers
export function toggleDebug() {
	debugMode.update((current) => {
		const newValue = !current;
		console.log(`Debug mode ${newValue ? 'enabled' : 'disabled'}`);
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

// Data rate tracking
export const dataRate = writable(0);

// Action to update data rate
export function setDataRate(rate) {
	dataRate.set(rate);
}

// You can also create a derived store for data rate status
export const dataRateStatus = derived(dataRate, ($dataRate) => {
	if ($dataRate < 10) return 'low';
	if ($dataRate < 25) return 'medium';
	return 'good';
});
