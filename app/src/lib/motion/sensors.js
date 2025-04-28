// Sensor mapping and configuration

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
		'right_upper_arm',
		'right_arm'
	],
	RightLowerArm: [
		'RightLowerArm',
		'RightForeArm',
		'mixamorig:RightForeArm',
		'right_lower_arm',
		'right_forearm'
	],
	LeftUpperArm: ['LeftUpperArm', 'LeftArm', 'mixamorig:LeftArm', 'left_upper_arm', 'left_arm'],
	LeftLowerArm: [
		'LeftLowerArm',
		'LeftForeArm',
		'mixamorig:LeftForeArm',
		'left_lower_arm',
		'left_forearm'
	],
	RightUpperLeg: [
		'RightUpperLeg',
		'RightUpLeg',
		'mixamorig:RightUpLeg',
		'right_upper_leg',
		'right_thigh'
	],
	RightLowerLeg: [
		'RightLowerLeg',
		'RightLeg',
		'mixamorig:RightLeg',
		'right_lower_leg',
		'right_leg',
		'right_shin'
	],
	LeftUpperLeg: [
		'LeftUpperLeg',
		'LeftUpLeg',
		'mixamorig:LeftUpLeg',
		'left_upper_leg',
		'left_thigh'
	],
	LeftLowerLeg: [
		'LeftLowerLeg',
		'LeftLeg',
		'mixamorig:LeftLeg',
		'left_lower_leg',
		'left_leg',
		'left_shin'
	]
};

// Find a matching bone in the model based on standard naming patterns
export function findMatchingBone(object, bodyPart) {
	if (!object || !object.name || !bodyPart) return false;

	const patterns = boneNamePatterns[bodyPart] || [bodyPart];
	const objectNameLower = object.name.toLowerCase();

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

// Get all sensors with data from the sensor data object
// In app/src/lib/motion/sensors.js
// Update the getSensorsWithData function

export function getSensorsWithData(sensorData) {
	if (!sensorData) return [];

	// Enable debug for troubleshooting
	let isDebug = true; // Force debug on temporarily to diagnose issues

	// Also check window.__debugModeValue if available
	try {
		if (typeof window !== 'undefined' && window.__debugModeValue !== undefined) {
			isDebug = isDebug || !!window.__debugModeValue;
		}
	} catch (_) {
		// In server environment, keep the default
	}

	// Handle case where sensorData might be inside a nested structure
	let actualSensorData = sensorData;
	if (sensorData.sensorData && typeof sensorData.sensorData === 'object') {
		actualSensorData = sensorData.sensorData;
		if (isDebug) console.log('Unwrapped nested sensorData');
	}

	if (isDebug) {
		console.log('Processing sensor data:', actualSensorData);
	}

	// Get all sensor keys (S0, S1, etc.)
	const sensorKeys = Object.keys(actualSensorData).filter(
		(key) => key.startsWith('S') && /^S\d+$/.test(key)
	);

	if (isDebug) {
		console.log(`Found ${sensorKeys.length} sensor entries in data:`, sensorKeys);

		// Log the actual data structures for diagnosis
		sensorKeys.forEach((key) => {
			console.log(`${key} data:`, actualSensorData[key]);
		});
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

	if (isDebug) {
		console.log(
			`Processed ${result.length} valid sensors with mappings:`,
			result.map((s) => `${s.bodyPart}(${s.index})`)
		);
	}

	return result;
}

// Map sensor data to a model's skeleton
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
		totalBones: sensors.length
	};
}
