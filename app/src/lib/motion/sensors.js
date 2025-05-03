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
		'mixamorig1RightArm',
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
		'mixamorig1RightForeArm',
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
		'mixamorig1LeftArm',
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
		'mixamorig1LeftForeArm',
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
		'mixamorig1RightUpLeg',
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
		'mixamorig1RightLeg',
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
		'mixamorig1LeftUpLeg',
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
		'mixamorig1LeftLeg',
		'left_lower_leg',
		'left_leg',
		'left_shin',
		'L_Leg',
		'LLegLow',
		'Shin_L'
	]
};

const dataFormatCache = {
	nestedFormat: false,
	directFormat: false,
	analyzed: false,
	logged: false
};

export function resetDataFormatCache() {
	dataFormatCache.nestedFormat = false;
	dataFormatCache.directFormat = false;
	dataFormatCache.analyzed = false;
	dataFormatCache.logged = false;
	console.log('Sensor data format cache reset');
}

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

export function getSensorsWithData(sensorData) {
	if (!sensorData) return [];

	const isDebug = isDebugEnabled();

	let actualSensorData = sensorData;

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

	if (dataFormatCache.nestedFormat && sensorData.sensorData) {
		actualSensorData = sensorData.sensorData;
	}

	const sensorKeys = Object.keys(actualSensorData).filter(
		(key) => key.startsWith('S') && /^S\d+$/.test(key)
	);

	if (isDebug && sensorKeys.length > 0 && !dataFormatCache.logged) {
		console.log(`Found ${sensorKeys.length} sensor entries in data:`, sensorKeys);

		const firstKey = sensorKeys[0];
		console.log(`Sample data format (${firstKey}):`, actualSensorData[firstKey]);

		dataFormatCache.logged = true;
	} else if (isDebug && sensorKeys.length === 0 && Object.keys(actualSensorData).length > 0) {
		console.warn('No sensor keys found in data object with keys:', Object.keys(actualSensorData));

		if ('sequence' in actualSensorData) {
			console.log('Data appears to have a sequence number but no sensor data');
		}
	}

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

	if (result.length === 0 && isDebug && 'sequence' in actualSensorData) {
		console.warn('Zero sensors extracted from data with sequence:', actualSensorData.sequence);
	}

	return result;
}

export function findMatchingBone(object, bodyPart) {
	if (!object || !object.name || !bodyPart) return false;

	const patterns = boneNamePatterns[bodyPart] || [bodyPart];
	const objectNameLower = object.name.toLowerCase();

	if (object.name.startsWith('mixamorig1')) {
		const nameWithoutPrefix = object.name.replace('mixamorig1', '');

		for (const pattern of patterns) {
			if (pattern.startsWith('mixamorig1')) continue;

			if (nameWithoutPrefix === pattern) {
				return true;
			}
		}
	}

	return patterns.some((pattern) => {
		if (object.name === pattern) return true;

		if (objectNameLower === pattern.toLowerCase()) return true;

		if (objectNameLower.includes(pattern.toLowerCase())) return true;

		return false;
	});
}

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
