import { incrementPacketCount } from '../stores/connectionStore.js';
import { setDataRate } from '../stores/motionStore.js';

const MAX_WINDOW_SIZE = 5000; // 5 seconds for rate calculation
const MAX_HISTORY = 30; // History points for trend analysis

let packetTimestamps = [];
let lastRate = 0;
let rateHistory = [];
let lastSequence = -1;
let outOfOrderCount = 0;
let missedPackets = 0;

export function trackDataReception(data = null) {
	const now = performance.now();

	packetTimestamps.push(now);

	while (packetTimestamps.length > 0 && now - packetTimestamps[0] > MAX_WINDOW_SIZE) {
		packetTimestamps.shift();
	}

	const currentRate = packetTimestamps.length / (MAX_WINDOW_SIZE / 1000);

	rateHistory.push(currentRate);
	if (rateHistory.length > MAX_HISTORY) {
		rateHistory.shift();
	}

	let trend = 'steady';
	if (rateHistory.length > 5) {
		const recentAvg = rateHistory.slice(-5).reduce((sum, rate) => sum + rate, 0) / 5;
		const olderAvg = rateHistory.slice(0, 5).reduce((sum, rate) => sum + rate, 0) / 5;
		const difference = recentAvg - olderAvg;

		if (difference > 2) trend = 'increasing';
		else if (difference < -2) trend = 'decreasing';
	}

	const shouldLogRate = Math.abs(currentRate - lastRate) > 5;
	if (shouldLogRate) {
		console.log(`Data rate: ${currentRate.toFixed(1)} packets/sec (${trend})`);
		lastRate = currentRate;
		setDataRate(currentRate);
	}

	incrementPacketCount();

	if (data && data.sequence !== undefined) {
		checkSequence(data.sequence);
	}

	return {
		rate: currentRate,
		trend,
		packetTimestamps: packetTimestamps.length
	};
}

function checkSequence(sequence) {
	if (lastSequence === -1) {
		lastSequence = sequence;
		return;
	}

	const expectedSequence = (lastSequence + 1) % 65536; // Wrap at 16-bit

	if (sequence !== expectedSequence) {
		if (sequence > expectedSequence) {
			const missed = sequence - expectedSequence;
			if (missed < 1000) {
				missedPackets += missed;
				if (missed > 10) {
					console.warn(`Missing ${missed} packets between ${lastSequence} and ${sequence}`);
				}
			}
		} else {
			outOfOrderCount++;
			if (outOfOrderCount % 10 === 1) {
				console.warn(`Out-of-order packet: ${sequence} after ${lastSequence}`);
			}
		}
	}

	lastSequence = sequence;
}

export function parseDataMessage(message) {
	if (!message) return null;

	try {
		let dataStart = message.indexOf('QUAT_DATA:');
		if (dataStart === -1) return null;

		const prefix = 'QUAT_DATA:';
		if (message.includes('DATA:QUAT_DATA:')) {
			dataStart = message.indexOf('DATA:QUAT_DATA:') + 5; // Skip 'DATA:' prefix
		}

		const cleanMessage = message.substring(dataStart + prefix.length).trim();

		const result = {};

		if (cleanMessage.includes('SEQ:')) {
			const seqPart = cleanMessage.substring(cleanMessage.indexOf('SEQ:') + 4);
			const seqEnd = seqPart.indexOf(',');
			if (seqEnd > 0) {
				result.sequence = parseInt(seqPart.substring(0, seqEnd), 10);
			}
		}

		let currentPos = 0;
		while ((currentPos = cleanMessage.indexOf('S', currentPos)) !== -1) {
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
				// Store data with S prefix (S0, S1, etc.) to match expected format
				result[`S${sensorId}`] = values;

				// Enable to force debug log for the first 5 packets
				if (result.sequence < 5) {
					console.log(`Parsed sensor S${sensorId} data:`, values);
				}
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

export function getPacketStats() {
	return {
		missedPackets,
		outOfOrderCount,
		currentRate: lastRate,
		totalTimestamps: packetTimestamps.length
	};
}

export function resetPacketStats() {
	packetTimestamps = [];
	lastRate = 0;
	rateHistory = [];
	lastSequence = -1;
	outOfOrderCount = 0;
	missedPackets = 0;
}
