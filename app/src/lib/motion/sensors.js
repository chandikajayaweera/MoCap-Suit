// Fixed sensors.js with improved sensor mapping
import { debugMode } from '$lib/stores/motionStore.js';

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
		// X Bot specific
		'Armature_UpperArm_R',
		'UpperArm_R',
		'RightUpperArm',
		'RightArm',
		'mixamorig:RightArm',
		'mixamorigRightArm',
		// CMU/Other models
		'right_upper_arm',
		'right_arm',
		'upperarm_r',
		'Upperarm_R',
		'arm.R',
		'Arm.R',
		'Bip001 R UpperArm',
		'R_arm'
	],
	RightLowerArm: [
		// X Bot specific
		'Armature_LowerArm_R',
		'LowerArm_R',
		// Standard naming
		'RightLowerArm',
		'RightForeArm',
		// Mixamo
		'mixamorig:RightForeArm',
		// Other models
		'right_lower_arm',
		'right_forearm',
		'lowerarm_r',
		'Lowerarm_R',
		'forearm.R',
		'Forearm.R',
		'Bip001 R Forearm',
		'R_forearm'
	],
	LeftUpperArm: [
		// X Bot specific
		'Armature_UpperArm_L',
		'UpperArm_L',
		// Standard
		'LeftUpperArm',
		'LeftArm',
		// Mixamo
		'mixamorig:LeftArm',
		// Others
		'left_upper_arm',
		'left_arm',
		'upperarm_l',
		'Upperarm_L',
		'arm.L',
		'Arm.L',
		'Bip001 L UpperArm',
		'L_arm'
	],
	LeftLowerArm: [
		// X Bot specific
		'Armature_LowerArm_L',
		'LowerArm_L',
		// Standard
		'LeftLowerArm',
		'LeftForeArm',
		// Mixamo
		'mixamorig:LeftForeArm',
		// Others
		'left_lower_arm',
		'left_forearm',
		'lowerarm_l',
		'Lowerarm_L',
		'forearm.L',
		'Forearm.L',
		'Bip001 L Forearm',
		'L_forearm'
	],
	RightUpperLeg: [
		// X Bot specific
		'Armature_UpperLeg_R',
		'UpperLeg_R',
		// Standard
		'RightUpperLeg',
		'RightUpLeg',
		// Mixamo
		'mixamorig:RightUpLeg',
		// Others
		'right_upper_leg',
		'right_thigh',
		'thigh_r',
		'Thigh_R',
		'Bip001 R Thigh',
		'R_leg'
	],
	RightLowerLeg: [
		// X Bot specific
		'Armature_LowerLeg_R',
		'LowerLeg_R',
		// Standard
		'RightLowerLeg',
		'RightLeg',
		// Mixamo
		'mixamorig:RightLeg',
		// Others
		'right_lower_leg',
		'right_leg',
		'shin_r',
		'Shin_R',
		'Bip001 R Calf',
		'R_shin'
	],
	LeftUpperLeg: [
		// X Bot specific
		'Armature_UpperLeg_L',
		'UpperLeg_L',
		// Standard
		'LeftUpperLeg',
		'LeftUpLeg',
		// Mixamo
		'mixamorig:LeftUpLeg',
		// Others
		'left_upper_leg',
		'left_thigh',
		'thigh_l',
		'Thigh_L',
		'Bip001 L Thigh',
		'L_leg'
	],
	LeftLowerLeg: [
		// X Bot specific
		'Armature_LowerLeg_L',
		'LowerLeg_L',
		// Standard
		'LeftLowerLeg',
		'LeftLeg',
		// Mixamo
		'mixamorig:LeftLeg',
		// Others
		'left_lower_leg',
		'left_leg',
		'shin_l',
		'Shin_L',
		'Bip001 L Calf',
		'L_shin'
	]
};

// Find a matching bone in the model based on standard naming patterns
export function findMatchingBone(object, bodyPart) {
	if (!object || !object.name || !bodyPart) return false;

	const patterns = boneNamePatterns[bodyPart] || [bodyPart];
	const objectNameLower = object.name.toLowerCase();

	// IMPROVED: More flexible bone matching logic
	for (const pattern of patterns) {
		// Try exact match
		if (object.name === pattern) return true;

		// Try case insensitive match
		if (objectNameLower === pattern.toLowerCase()) return true;

		// Try includes for more flexible matching
		if (objectNameLower.includes(pattern.toLowerCase())) return true;

		// Try variants with underscores/hyphens
		const normalizedPattern = pattern.toLowerCase().replace(/[_\-.]/g, '');
		const normalizedName = objectNameLower.replace(/[_\-.]/g, '');
		if (normalizedName.includes(normalizedPattern)) return true;

		// For XBot model specific patterns
		if (
			(bodyPart.includes('Right') && objectNameLower.includes('right')) ||
			(bodyPart.includes('Left') && objectNameLower.includes('left'))
		) {
			// Additional checks for arm/leg parts
			if (
				(bodyPart.includes('Arm') && objectNameLower.includes('arm')) ||
				(bodyPart.includes('Leg') && objectNameLower.includes('leg'))
			) {
				// Further distinguish upper/lower
				if (
					(bodyPart.includes('Upper') &&
						(objectNameLower.includes('upper') || objectNameLower.includes('up'))) ||
					(bodyPart.includes('Lower') &&
						(objectNameLower.includes('lower') ||
							objectNameLower.includes('fore') ||
							objectNameLower.includes('shin')))
				) {
					return true;
				}
			}
		}
	}

	return false;
}

// Get all sensors with data from the sensor data object
export function getSensorsWithData(sensorData) {
	if (!sensorData) return [];

	// Check if we're in debug mode
	let isDebug = false;
	try {
		const unsubscribe = debugMode.subscribe((value) => {
			isDebug = value;
		});
		unsubscribe();
	} catch (_) {
		// Use local debug flag if store not available
		isDebug = typeof window !== 'undefined' && !!window.__debugModeValue;
	}

	// Better handling of nested data structures
	let actualSensorData = sensorData;

	// Check for common nesting patterns and unwrap as needed
	if (sensorData.data && sensorData.data.sensorData) {
		actualSensorData = sensorData.data.sensorData;
	} else if (sensorData.sensorData) {
		actualSensorData = sensorData.sensorData;
	} else if (sensorData.data) {
		// Check if data appears to be the actual sensor data
		const hasSequence = 'sequence' in sensorData.data;
		const hasSensors = Object.keys(sensorData.data).some((key) => /^S\d+$/.test(key));

		if (hasSequence || hasSensors) {
			actualSensorData = sensorData.data;
		}
	}

	if (isDebug) {
		console.log('Processing sensor data:', actualSensorData);
	}

	// Get all sensor keys (S0, S1, etc.)
	const sensorKeys = Object.keys(actualSensorData).filter((key) => /^S\d+$/.test(key));

	if (isDebug && sensorKeys.length === 0) {
		// Check if there are any sensor-like keys that don't match our pattern
		console.warn('No standard sensor keys found. Available keys:', Object.keys(actualSensorData));
	}

	// Filter for valid sensor data and map to structured objects
	const result = sensorKeys
		.filter((key) => {
			const value = actualSensorData[key];

			// Handle different array formats - some systems send arrays, others send string representations
			let dataArray;

			if (Array.isArray(value)) {
				dataArray = value;
			} else if (typeof value === 'string' && value.includes(',')) {
				// Try to parse string representation "[w,x,y,z]" or "w,x,y,z"
				try {
					const cleanStr = value.replace(/[[\]]/g, '').trim();
					dataArray = cleanStr.split(',').map(Number);
				} catch (_) {
					return false;
				}
			} else {
				return false;
			}

			// Check if we have valid quaternion data (4 numbers)
			const isValid =
				dataArray &&
				dataArray.length === 4 &&
				dataArray.every((val) => typeof val === 'number' && !isNaN(val));

			// Additional validation: check if values are reasonable for quaternions
			if (isValid) {
				// Quaternions should generally have a magnitude of ~1
				const [w, x, y, z] = dataArray;
				const magnitude = Math.sqrt(w * w + x * x + y * y + z * z);

				// If magnitude is way off, something's wrong with the data
				if (magnitude < 0.1 || magnitude > 10) {
					if (isDebug) {
						console.warn(
							`Unusual quaternion magnitude (${magnitude.toFixed(2)}) for ${key}: [${dataArray.join(', ')}]`
						);
					}
					// Still return true, we'll let the animation code decide what to do
				}
			}

			return isValid;
		})
		.map((key) => {
			const index = parseInt(key.substring(1), 10);
			const bodyPart = sensorMapping[index];

			// Handle the data format (array or string)
			let dataArray = actualSensorData[key];
			if (typeof dataArray === 'string') {
				const cleanStr = dataArray.replace(/[[\]]/g, '').trim();
				dataArray = cleanStr.split(',').map(Number);
			}

			return {
				index,
				data: dataArray,
				bodyPart
			};
		});

	// Log detailed diagnostic info if needed
	if (isDebug) {
		console.log(
			`Found ${result.length} valid sensors with data from ${sensorKeys.length} sensor entries`
		);

		// Check for missing body part mappings
		const unmappedSensors = result.filter((s) => !s.bodyPart);
		if (unmappedSensors.length > 0) {
			console.warn(
				'Missing body part mappings for sensors:',
				unmappedSensors.map((s) => `S${s.index}`).join(', ')
			);
		}

		// Log quaternion data from first sensor as sample
		if (result.length > 0) {
			console.log(
				`Sample sensor data (${result[0].bodyPart || 'unknown'}): [${result[0].data.join(', ')}]`
			);
		}
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
