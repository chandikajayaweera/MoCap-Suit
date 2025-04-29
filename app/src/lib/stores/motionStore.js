// Motion capture data and application state store
import { writable, derived, get } from 'svelte/store';

// Core application state
export const connected = writable(false);
export const sensorData = writable({});
// Visualization settings
export const selectedModel = writable('xbot');
export const selectedEnvironment = writable('studio');
export const showSkeleton = writable(false);
export const debugMode = writable(false);

// Loading state
export const loading = writable(false);

// Data rate tracking
export const dataRate = writable(0);

// Stats tracking
export const updateCount = writable(0);
export const mappingStats = writable({
	totalSensors: 0,
	mappedSensors: 0,
	lastUpdate: 0
});

// Subscription handler to debug mode toggle and initialization
// This will sync the window.__debugModeValue with the store
debugMode.subscribe((value) => {
	if (typeof window !== 'undefined') {
		window.__debugModeValue = value;
	}
});

// Helper to get current debug mode value without subscription
export function debugEnabled() {
	// Try to use the global window property first for better performance
	if (typeof window !== 'undefined' && typeof window.__debugModeValue === 'boolean') {
		return window.__debugModeValue;
	}

	// Fall back to store if needed
	return get(debugMode);
}

// Derived values for UI
export const isStreaming = derived(
	[connected, sensorData],
	([$connected, $sensorData]) => $connected && Object.keys($sensorData).length > 0
);

/**
 * Update sensor data safely
 * @param {Object} newData - New sensor data to store
 */
export function updateSensorData(newData) {
	if (!newData) return;

	try {
		// Increment update counter
		updateCount.update((count) => count + 1);

		// Log updates occasionally for debugging
		if (newData.sequence && newData.sequence % 50 === 0) {
			console.log(`Motion store updating with sequence ${newData.sequence}`);

			// Count sensors
			const sensorCount = Object.keys(newData).filter((key) => key.startsWith('S')).length;

			// Update mapping stats
			mappingStats.update((stats) => ({
				...stats,
				totalSensors: sensorCount,
				lastUpdate: Date.now()
			}));
		}

		// Important: create a new object to trigger reactivity
		sensorData.set({ ...newData });
	} catch (error) {
		console.error('Error updating sensor data in store:', error);
	}
}

/**
 * Set connection status
 * @param {boolean} status - Connection status
 */
export function setConnected(status) {
	connected.set(status);

	// Reset data when disconnecting
	if (!status) {
		sensorData.set({});
		updateCount.set(0);
	}
}

/**
 * Select model
 * @param {string} modelId - Model ID to select
 */
export function selectModel(modelId) {
	console.log(`Setting model to: ${modelId}`);
	selectedModel.set(modelId);
}

/**
 * Select environment
 * @param {string} envId - Environment ID to select
 */
export function selectEnvironment(envId) {
	console.log(`Setting environment to: ${envId}`);
	selectedEnvironment.set(envId);
}

/**
 * Toggle skeleton visibility
 */
export function toggleSkeleton() {
	showSkeleton.update((current) => {
		const newValue = !current;
		console.log(`Skeleton visibility ${newValue ? 'enabled' : 'disabled'}`);
		return newValue;
	});
}

/**
 * Set loading state
 * @param {boolean} isLoading - Loading state
 */
export function setLoading(isLoading) {
	loading.set(isLoading);
}

/**
 * Toggle debug mode
 */
export function toggleDebug() {
	debugMode.update((current) => {
		const newValue = !current;
		console.log(`Debug mode ${newValue ? 'enabled' : 'disabled'}`);
		window.__debugModeValue = newValue;
		return newValue;
	});
}

/**
 * Log debug message if debug mode is enabled
 * @param {string} message - Message to log
 * @param {*} data - Optional data to log
 */
export function logDebug(message, data) {
	// Get the current debug mode value
	const isDebug = debugEnabled();

	if (isDebug) {
		if (data) {
			console.log(`[DEBUG] ${message}`, data);
		} else {
			console.log(`[DEBUG] ${message}`);
		}
	}
}

/**
 * Update data rate
 * @param {number} rate - Current data rate
 */
export function setDataRate(rate) {
	dataRate.set(rate);
}

/**
 * Update bone mapping statistics
 * @param {Object} stats - Mapping statistics
 */
export function updateMappingStats(stats) {
	mappingStats.update((current) => ({
		...current,
		...stats,
		lastUpdate: Date.now()
	}));
}

// Derived store for data rate status
export const dataRateStatus = derived(dataRate, ($dataRate) => {
	if ($dataRate < 10) return 'low';
	if ($dataRate < 25) return 'medium';
	return 'good';
});
