import { writable, derived } from 'svelte/store';
import { quaternionToEuler } from '$lib/utils/quaternion';

// Initialize store with empty data
const initialState = {
	isStreaming: false,
	sequence: 0,
	timestamp: null,
	sensors: {
		// Initialize with null values for all 8 sensors
		0: { id: 0, name: 'Right Lower Leg', quaternion: null, euler: null, isActive: false },
		1: { id: 1, name: 'Right Upper Leg', quaternion: null, euler: null, isActive: false },
		2: { id: 2, name: 'Left Lower Leg', quaternion: null, euler: null, isActive: false },
		3: { id: 3, name: 'Left Upper Leg', quaternion: null, euler: null, isActive: false },
		4: { id: 4, name: 'Left Lower Arm', quaternion: null, euler: null, isActive: false },
		5: { id: 5, name: 'Left Upper Arm', quaternion: null, euler: null, isActive: false },
		6: { id: 6, name: 'Right Lower Arm', quaternion: null, euler: null, isActive: false },
		7: { id: 7, name: 'Right Upper Arm', quaternion: null, euler: null, isActive: false }
	},
	stats: {
		packetsReceived: 0,
		lastUpdateTime: null,
		updatesPerSecond: 0,
		packetsLost: 0
	}
};

// Create the writable store
const { subscribe, set, update } = writable(initialState);

// Track performance metrics
let lastSequence = null;
let frameTimestamps = [];
const MAX_FRAME_HISTORY = 100;

function updateStats() {
	return update((state) => {
		// Calculate updates per second based on frame timestamps
		const now = Date.now();
		frameTimestamps = frameTimestamps.filter((ts) => now - ts < 1000); // Keep only last second

		return {
			...state,
			stats: {
				...state.stats,
				updatesPerSecond: frameTimestamps.length
			}
		};
	});
}

// Calculate the number of active sensors
const activeSensors = derived({ subscribe }, ($state) => {
	return Object.values($state.sensors).filter((sensor) => sensor.isActive).length;
});

// Create the sensor store with custom methods
const sensorStore = {
	subscribe,

	// Reset the store to initial state
	reset: () => set(initialState),

	// Update with new sensor data
	updateSensorData: (data) => {
		if (!data || !data.sensorData) return;

		// Track frame for performance stats
		frameTimestamps.push(Date.now());
		if (frameTimestamps.length > MAX_FRAME_HISTORY) {
			frameTimestamps.shift();
		}

		update((state) => {
			const newState = {
				...state,
				isStreaming: true,
				timestamp: data.timestamp || Date.now(),
				stats: {
					...state.stats,
					packetsReceived: state.stats.packetsReceived + 1,
					lastUpdateTime: Date.now()
				}
			};

			// Check for sequence number to detect packet loss
			if (data.sensorData.sequence !== undefined) {
				newState.sequence = data.sensorData.sequence;

				if (lastSequence !== null) {
					const expectedSequence = (lastSequence + 1) % 65536; // Wrap around at 65536
					if (newState.sequence !== expectedSequence) {
						const lost = (newState.sequence - expectedSequence + 65536) % 65536;
						if (lost > 0 && lost < 1000) {
							// Sanity check for reasonable values
							newState.stats.packetsLost += lost;
						}
					}
				}

				lastSequence = newState.sequence;
			}

			// Update each sensor
			Object.entries(data.sensorData).forEach(([key, value]) => {
				// Skip non-sensor entries like sequence
				if (!key.startsWith('S')) return;

				const sensorIdx = parseInt(key.substring(1), 10);
				if (isNaN(sensorIdx) || sensorIdx < 0 || sensorIdx > 7) return;

				if (Array.isArray(value) && value.length === 4) {
					// We have valid quaternion data
					const euler = quaternionToEuler(value);

					newState.sensors[sensorIdx] = {
						...newState.sensors[sensorIdx],
						quaternion: value,
						euler: euler,
						isActive: true
					};
				}
			});

			return newState;
		});

		// Update performance stats periodically
		updateStats();
	},

	// Mark streaming as stopped
	stopStreaming: () => {
		update((state) => ({
			...state,
			isStreaming: false
		}));
	},

	// Get stats
	activeSensors
};

export default sensorStore;
