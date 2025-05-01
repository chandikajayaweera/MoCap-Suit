// Enhanced sensor mapping and configuration

// Maps sensor indices to body part names
export const sensorMapping = {
	0: 'RightLowerLeg',
	1: 'RightUpperLeg',
	2: 'LeftLowerLeg',
	3: 'LeftUpperLeg',
	4: 'LeftLowerArm',
	5: 'LeftUpperArm',
	6: 'RightLowerArm',
	7: 'RightUpperArm'
};

// Common bone naming patterns in various model formats
export const boneNamePatterns = {
	RightUpperArm: [
		'RightUpperArm',
		'RightArm',
		'mixamorig:RightArm',
		'mixamorig1RightArm', // Specifically for our model
		'right_upper_arm',
		'right_arm',
		'R_Arm',
		'RArmHigh',
		'Arm_R'
	],
	RightLowerArm: [
		'RightLowerArm',
		'RightForeArm',
		'mixamorig:RightForeArm',
		'mixamorig1RightForeArm', // Specifically for our model
		'right_lower_arm',
		'right_forearm',
		'R_ForeArm',
		'RArmLow',
		'ForeArm_R'
	],
	LeftUpperArm: [
		'LeftUpperArm',
		'LeftArm',
		'mixamorig:LeftArm',
		'mixamorig1LeftArm', // Specifically for our model
		'left_upper_arm',
		'left_arm',
		'L_Arm',
		'LArmHigh',
		'Arm_L'
	],
	LeftLowerArm: [
		'LeftLowerArm',
		'LeftForeArm',
		'mixamorig:LeftForeArm',
		'mixamorig1LeftForeArm', // Specifically for our model
		'left_lower_arm',
		'left_forearm',
		'L_ForeArm',
		'LArmLow',
		'ForeArm_L'
	],
	RightUpperLeg: [
		'RightUpperLeg',
		'RightUpLeg',
		'mixamorig:RightUpLeg',
		'mixamorig1RightUpLeg', // Specifically for our model
		'right_upper_leg',
		'right_thigh',
		'R_UpLeg',
		'RLegHigh',
		'Thigh_R'
	],
	RightLowerLeg: [
		'RightLowerLeg',
		'RightLeg',
		'mixamorig:RightLeg',
		'mixamorig1RightLeg', // Specifically for our model
		'right_lower_leg',
		'right_leg',
		'right_shin',
		'R_Leg',
		'RLegLow',
		'Shin_R'
	],
	LeftUpperLeg: [
		'LeftUpperLeg',
		'LeftUpLeg',
		'mixamorig:LeftUpLeg',
		'mixamorig1LeftUpLeg', // Specifically for our model
		'left_upper_leg',
		'left_thigh',
		'L_UpLeg',
		'LLegHigh',
		'Thigh_L'
	],
	LeftLowerLeg: [
		'LeftLowerLeg',
		'LeftLeg',
		'mixamorig:LeftLeg',
		'mixamorig1LeftLeg', // Specifically for our model
		'left_lower_leg',
		'left_leg',
		'left_shin',
		'L_Leg',
		'LLegLow',
		'Shin_L'
	]
};

// Cache of analyzed sensor data formats for faster processing
const dataFormatCache = {
	nestedFormat: false,
	directFormat: false,
	analyzed: false,
	logged: false
};

/**
 * Reset the data format cache (useful when switching data sources)
 */
export function resetDataFormatCache() {
	dataFormatCache.nestedFormat = false;
	dataFormatCache.directFormat = false;
	dataFormatCache.analyzed = false;
	dataFormatCache.logged = false;
	console.log('Sensor data format cache reset');
}

/**
 * Check if debug mode is enabled
 * @returns {boolean} - Whether debug mode is enabled
 */
function isDebugEnabled() {
	try {
		if (typeof window !== 'undefined' && window.__debugModeValue !== undefined) {
			return !!window.__debugModeValue;
		}
		// eslint-disable-next-line no-unused-vars
	} catch (e) {
		// Silent fail for server-side rendering
	}
	return false;
}

/**
 * Intelligent sensor data parser that works with multiple data formats
 * @param {Object} sensorData - Raw sensor data object
 * @returns {Array} - Array of processed sensor objects
 */
export function getSensorsWithData(sensorData) {
	if (!sensorData) return [];

	// Get debug status
	const isDebug = isDebugEnabled();

	// Handle different data formats based on previously identified patterns
	let actualSensorData = sensorData;

	// If we haven't analyzed this format yet, do so now
	if (!dataFormatCache.analyzed) {
		if (sensorData.sensorData && typeof sensorData.sensorData === 'object') {
			if (isDebug) console.log('Detected nested sensorData format');
			dataFormatCache.nestedFormat = true;
			dataFormatCache.analyzed = true;
		} else if (
			typeof sensorData === 'object' &&
			Object.keys(sensorData).some((k) => k.startsWith('S') || k === 'sequence')
		) {
			if (isDebug) console.log('Detected direct sensor data format');
			dataFormatCache.directFormat = true;
			dataFormatCache.analyzed = true;
		}
	}

	// Apply the correct format extraction
	if (dataFormatCache.nestedFormat && sensorData.sensorData) {
		actualSensorData = sensorData.sensorData;
	}

	// Get all sensor keys (S0, S1, etc.)
	const sensorKeys = Object.keys(actualSensorData).filter(
		(key) => key.startsWith('S') && /^S\d+$/.test(key)
	);

	if (isDebug && sensorKeys.length > 0 && !dataFormatCache.logged) {
		console.log(`Found ${sensorKeys.length} sensor entries in data:`, sensorKeys);

		// Sample the first sensor data to understand format
		const firstKey = sensorKeys[0];
		console.log(`Sample data format (${firstKey}):`, actualSensorData[firstKey]);

		dataFormatCache.logged = true;
	} else if (isDebug && sensorKeys.length === 0 && Object.keys(actualSensorData).length > 0) {
		// This is a common issue during playback - help diagnose it
		console.warn('No sensor keys found in data object with keys:', Object.keys(actualSensorData));

		// If we have a sequence number, this is likely valid data but not in the expected format
		if ('sequence' in actualSensorData) {
			console.log('Data appears to have a sequence number but no sensor data');
		}
	}

	// Filter for valid sensor data and map to structured objects
	const result = sensorKeys
		.filter((key) => {
			const value = actualSensorData[key];
			const isValid = Array.isArray(value) && value.length === 4;

			if (!isValid && isDebug) {
				console.warn(`Invalid data format for sensor ${key}:`, value);
			}

			return isValid;
		})
		.map((key) => {
			const index = parseInt(key.substring(1), 10);
			const bodyPart = sensorMapping[index];

			if (!bodyPart && isDebug) {
				console.warn(`No body part mapping found for sensor ${key} (index ${index})`);
			}

			return {
				index,
				data: actualSensorData[key],
				bodyPart
			};
		});

	// Extra validation for playback
	if (result.length === 0 && isDebug && 'sequence' in actualSensorData) {
		console.warn('Zero sensors extracted from data with sequence:', actualSensorData.sequence);
	}

	return result;
}

/**
 * Find a matching bone in the model based on standard naming patterns
 * With special handling for mixamorig1 prefix used in our model
 * @param {Object} object - Bone object from model
 * @param {string} bodyPart - Body part identifier
 * @returns {boolean} - Whether this bone matches the body part
 */
export function findMatchingBone(object, bodyPart) {
	if (!object || !object.name || !bodyPart) return false;

	const patterns = boneNamePatterns[bodyPart] || [bodyPart];
	const objectNameLower = object.name.toLowerCase();

	// Special handling for mixamorig1 prefix in our model names
	if (object.name.startsWith('mixamorig1')) {
		// Create specific pattern without the mixamorig1 prefix to match against patterns
		const nameWithoutPrefix = object.name.replace('mixamorig1', '');

		// Check if any pattern matches the name without prefix
		for (const pattern of patterns) {
			// Skip mixamorig1 patterns since we're already checking specifically for those
			if (pattern.startsWith('mixamorig1')) continue;

			// Check if pattern matches the part after mixamorig1
			if (nameWithoutPrefix === pattern) {
				return true;
			}
		}
	}

	// Standard pattern matching
	return patterns.some((pattern) => {
		// Try exact match
		if (object.name === pattern) return true;

		// Try case insensitive match
		if (objectNameLower === pattern.toLowerCase()) return true;

		// Try includes
		if (objectNameLower.includes(pattern.toLowerCase())) return true;

		return false;
	});
}

/**
 * Map sensor data to a model's skeleton for analysis
 * @param {Object} model - The 3D model
 * @param {Object} sensorData - Sensor data object
 * @returns {Object} - Analysis of bone mapping
 */
export function mapSensorsToSkeleton(model, sensorData) {
	const sensors = getSensorsWithData(sensorData);
	const bonesUpdated = [];

	if (!model || !sensors.length) return { success: false, bonesUpdated };

	model.traverse((object) => {
		if (object.isBone || object.type === 'Bone') {
			for (const sensor of sensors) {
				if (sensor.bodyPart && findMatchingBone(object, sensor.bodyPart)) {
					bonesUpdated.push({
						name: object.name,
						bodyPart: sensor.bodyPart,
						sensorIndex: sensor.index
					});
					break;
				}
			}
		}
	});

	return {
		success: bonesUpdated.length > 0,
		bonesUpdated,
		totalSensors: sensors.length,
		mappedSensors: bonesUpdated.length
	};
}
