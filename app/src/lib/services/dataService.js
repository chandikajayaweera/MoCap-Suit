// Data processing functionality
import { incrementPacketCount } from '../stores/connectionStore.js';
import { setDataRate } from '../stores/motionStore.js';

// Constants
const MAX_WINDOW_SIZE = 5000; // 5 seconds for rate calculation
const MAX_HISTORY = 30; // History points for trend analysis

// Tracking variables
let packetTimestamps = [];
let lastRate = 0;
let rateHistory = [];
let lastSequence = -1;
let outOfOrderCount = 0;
let missedPackets = 0;

/**
 * Track data reception and calculate metrics
 * @param {Object} data - Sensor data packet
 * @returns {Object} - Reception metrics
 */
export function trackDataReception(data = null) {
	const now = performance.now();

	// Store timestamp for rate calculation
	packetTimestamps.push(now);

	// Keep only recent packets in the window
	while (packetTimestamps.length > 0 && now - packetTimestamps[0] > MAX_WINDOW_SIZE) {
		packetTimestamps.shift();
	}

	// Calculate current rate (packets per second)
	const currentRate = packetTimestamps.length / (MAX_WINDOW_SIZE / 1000);

	// Store rate for trend analysis
	rateHistory.push(currentRate);
	if (rateHistory.length > MAX_HISTORY) {
		rateHistory.shift();
	}

	// Calculate trend
	let trend = 'steady';
	if (rateHistory.length > 5) {
		const recentAvg = rateHistory.slice(-5).reduce((sum, rate) => sum + rate, 0) / 5;
		const olderAvg = rateHistory.slice(0, 5).reduce((sum, rate) => sum + rate, 0) / 5;
		const difference = recentAvg - olderAvg;

		if (difference > 2) trend = 'increasing';
		else if (difference < -2) trend = 'decreasing';
	}

	// Log significant rate changes
	const shouldLogRate = Math.abs(currentRate - lastRate) > 5;
	if (shouldLogRate) {
		console.log(`Data rate: ${currentRate.toFixed(1)} packets/sec (${trend})`);
		lastRate = currentRate;
		setDataRate(currentRate);
	}

	// Increment packet counter in store
	incrementPacketCount();

	// Check sequence number if data is provided
	if (data && data.sequence !== undefined) {
		checkSequence(data.sequence);
	}

	// Return metrics for optional use
	return {
		rate: currentRate,
		trend,
		packetTimestamps: packetTimestamps.length
	};
}

/**
 * Check sequence number continuity
 * @param {number} sequence - Current sequence number
 */
function checkSequence(sequence) {
	if (lastSequence === -1) {
		lastSequence = sequence;
		return;
	}

	// Check for expected next sequence
	const expectedSequence = (lastSequence + 1) % 65536; // Wrap at 16-bit

	if (sequence !== expectedSequence) {
		// Out of order or missed packets
		if (sequence > expectedSequence) {
			// Missed packets
			const missed = sequence - expectedSequence;
			if (missed < 1000) {
				// Sanity check for reasonable values
				missedPackets += missed;
				if (missed > 10) {
					console.warn(`Missing ${missed} packets between ${lastSequence} and ${sequence}`);
				}
			}
		} else {
			// Out of order packet (earlier than expected)
			outOfOrderCount++;
			if (outOfOrderCount % 10 === 1) {
				// Log occasionally to avoid spam
				console.warn(`Out-of-order packet: ${sequence} after ${lastSequence}`);
			}
		}
	}

	// Update last sequence
	lastSequence = sequence;
}

/**
 * Parse sensor data from log message
 * @param {string} message - Log message containing sensor data
 * @returns {Object|null} - Parsed sensor data or null
 */
export function parseDataMessage(message) {
	if (!message) return null;

	try {
		// Extract the QUAT_DATA part
		let dataStart = message.indexOf('QUAT_DATA:');
		if (dataStart === -1) return null;

		// Handle different formats
		const prefix = 'QUAT_DATA:';
		if (message.includes('DATA:QUAT_DATA:')) {
			dataStart = message.indexOf('DATA:QUAT_DATA:') + 5; // Skip 'DATA:' prefix
		}

		// Extract and trim the data portion
		const cleanMessage = message.substring(dataStart + prefix.length).trim();

		const result = {};

		// Extract sequence number
		if (cleanMessage.includes('SEQ:')) {
			const seqPart = cleanMessage.substring(cleanMessage.indexOf('SEQ:') + 4);
			const seqEnd = seqPart.indexOf(',');
			if (seqEnd > 0) {
				result.sequence = parseInt(seqPart.substring(0, seqEnd), 10);
			}
		}

		// Extract sensor data
		let currentPos = 0;
		while ((currentPos = cleanMessage.indexOf('S', currentPos)) !== -1) {
			// Skip invalid patterns
			if (currentPos + 1 >= cleanMessage.length || !/\d/.test(cleanMessage[currentPos + 1])) {
				currentPos++;
				continue;
			}

			// Find format S0:[w,x,y,z]
			const sensorIdEnd = cleanMessage.indexOf(':', currentPos);
			if (sensorIdEnd === -1) break;

			const sensorId = cleanMessage.substring(currentPos + 1, sensorIdEnd);

			const valuesStart = cleanMessage.indexOf('[', sensorIdEnd);
			if (valuesStart === -1) break;

			const valuesEnd = cleanMessage.indexOf(']', valuesStart);
			if (valuesEnd === -1) break;

			const valuesStr = cleanMessage.substring(valuesStart + 1, valuesEnd);
			const values = valuesStr.split(',').map((v) => parseFloat(v.trim()));

			if (values.length === 4) {
				result[`S${sensorId}`] = values;
			}

			currentPos = valuesEnd + 1;
		}

		// Validate we have data before returning
		const sensorCount = Object.keys(result).filter((k) => k.startsWith('S')).length;
		if (sensorCount > 0 || result.sequence !== undefined) {
			return result;
		}

		return null;
	} catch (error) {
		console.error('Error parsing data message:', error);
		return null;
	}
}

/**
 * Get packet statistics
 * @returns {Object} - Packet statistics
 */
export function getPacketStats() {
	return {
		missedPackets,
		outOfOrderCount,
		currentRate: lastRate,
		totalTimestamps: packetTimestamps.length
	};
}

/**
 * Reset packet statistics
 */
export function resetPacketStats() {
	packetTimestamps = [];
	lastRate = 0;
	rateHistory = [];
	lastSequence = -1;
	outOfOrderCount = 0;
	missedPackets = 0;
}
