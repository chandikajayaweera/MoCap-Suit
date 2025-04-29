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
	if (typeof window !== 'undefined') {
		window.__debugModeValue = value;
	}
});

// Derived values for UI
export const isStreaming = derived(
	[connected, sensorData],
	([$connected, $sensorData]) => $connected && Object.keys($sensorData).length > 0
);

// Action to update sensor data
export function updateSensorData(newData) {
	if (!newData) {
		console.warn('motionStore: Attempted to update with null/undefined data');
		return;
	}

	// Log for debugging
	console.log('motionStore: Updating with data object:', {
		type: typeof newData,
		hasSequence: 'sequence' in newData,
		keyCount: Object.keys(newData).length,
		sensorCount: Object.keys(newData).filter((k) => /^S\d+$/.test(k)).length
	});

	try {
		// Handle different data structures
		let processedData = newData;

		// Unwrap nested data if necessary
		if (newData.sensorData) {
			processedData = newData.sensorData;
			console.log('motionStore: Unwrapped data from sensorData property');
		} else if (newData.data) {
			processedData = newData.data;
			console.log('motionStore: Unwrapped data from data property');
		}

		// Verify we have actual sensor data
		const sensorKeys = Object.keys(processedData).filter((k) => /^S\d+$/.test(k));

		if (sensorKeys.length === 0) {
			console.warn('motionStore: No sensor keys found in data - cannot update');
			return;
		}

		// Create a clean copy with proper structure
		const cleanData = {
			sequence: processedData.sequence || 0,
			timestamp: Date.now()
		};

		// Copy each sensor's quaternion data
		sensorKeys.forEach((key) => {
			const sensorData = processedData[key];

			// Verify quaternion format
			if (Array.isArray(sensorData) && sensorData.length === 4) {
				// Basic validation of quaternion components
				if (sensorData.every((v) => typeof v === 'number' && !isNaN(v))) {
					cleanData[key] = [...sensorData]; // Create a copy
				}
			}
		});

		// Only update the store if we have valid sensor data
		if (Object.keys(cleanData).length > 2) {
			// We have more than just sequence and timestamp
			console.log(`motionStore: Updating with ${Object.keys(cleanData).length - 2} sensors`);

			// Important: create a new object to trigger reactivity
			sensorData.set(cleanData);

			// Update window debug object for troubleshooting
			if (typeof window !== 'undefined') {
				// @ts-ignore - Adding debug property to window
				window.__lastSensorData = cleanData;
			}
		}
	} catch (error) {
		console.error('motionStore: Error updating sensor data:', error);
	}
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
