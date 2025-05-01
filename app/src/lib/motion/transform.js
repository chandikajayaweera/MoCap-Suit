// Sensor coordinate transformation system for accurate motion capture
import { getTHREE } from '../three/engine.js';
import { getSensorsWithData } from './sensors.js';

// Define default coordinate corrections for different body parts
// These values are tuned for the specific IMU placement on each body segment
export const DEFAULT_CORRECTIONS = {
	RightUpperArm: {
		// Rotation in Euler angles (degrees) to correct sensor orientation
		rotationCorrection: [0, 0, 90], // x, y, z in degrees
		// Axes to invert (1 = invert, 0 = keep)
		axisInversion: [0, 0, 1] // x, y, z
	},
	RightLowerArm: {
		rotationCorrection: [0, 0, 90],
		axisInversion: [0, 0, 1]
	},
	LeftUpperArm: {
		rotationCorrection: [0, 0, -90],
		axisInversion: [0, 0, 1]
	},
	LeftLowerArm: {
		rotationCorrection: [0, 0, -90],
		axisInversion: [0, 0, 1]
	},
	RightUpperLeg: {
		rotationCorrection: [90, 0, 0],
		axisInversion: [0, 1, 0]
	},
	RightLowerLeg: {
		rotationCorrection: [90, 0, 0],
		axisInversion: [0, 1, 0]
	},
	LeftUpperLeg: {
		rotationCorrection: [90, 0, 0],
		axisInversion: [0, 1, 0]
	},
	LeftLowerLeg: {
		rotationCorrection: [90, 0, 0],
		axisInversion: [0, 1, 0]
	}
};

// User-adjustable corrections - can be modified at runtime
export const userCorrections = {};

// Initialize with default corrections
export function initializeCorrections() {
	Object.keys(DEFAULT_CORRECTIONS).forEach((key) => {
		userCorrections[key] = JSON.parse(JSON.stringify(DEFAULT_CORRECTIONS[key]));
	});
}

// Reset to default corrections
export function resetCorrections() {
	initializeCorrections();
}

// Initialize on module load
initializeCorrections();

/**
 * Apply coordinate correction to sensor quaternion data
 * @param {Array} quaternionData - Raw sensor quaternion [w, x, y, z]
 * @param {String} bodyPart - Body part identifier
 * @returns {Promise<Array>} - Corrected quaternion [w, x, y, z]
 */
export async function correctQuaternion(quaternionData, bodyPart) {
	if (!quaternionData || !bodyPart) return quaternionData;

	const THREE = await getTHREE();

	// Get correction for this body part
	const correction = userCorrections[bodyPart];
	if (!correction) return quaternionData;

	// Create quaternion from sensor data - correct ordering
	const q = new THREE.Quaternion(
		quaternionData[1], // x
		quaternionData[2], // y
		quaternionData[3], // z
		quaternionData[0] // w
	);

	// Normalize to ensure unit quaternion
	q.normalize();

	// Apply rotation correction first if specified
	if (correction.rotationCorrection) {
		// Create correction quaternion from Euler angles (converting from degrees to radians)
		const correctionEuler = new THREE.Euler(
			(correction.rotationCorrection[0] * Math.PI) / 180,
			(correction.rotationCorrection[1] * Math.PI) / 180,
			(correction.rotationCorrection[2] * Math.PI) / 180,
			'XYZ'
		);
		const correctionQuaternion = new THREE.Quaternion().setFromEuler(correctionEuler);

		// Apply correction by multiplying - order is important!
		q.multiplyQuaternions(correctionQuaternion, q);
	}

	// Then apply axis inversion if needed (this is more reliable to do after the rotation)
	if (
		correction.axisInversion &&
		(correction.axisInversion[0] || correction.axisInversion[1] || correction.axisInversion[2])
	) {
		// Convert quaternion to euler for easier axis manipulation
		const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ');

		// Apply axis inversion
		if (correction.axisInversion[0]) euler.x = -euler.x;
		if (correction.axisInversion[1]) euler.y = -euler.y;
		if (correction.axisInversion[2]) euler.z = -euler.z;

		// Convert back to quaternion
		q.setFromEuler(euler);
	}

	// Return as array in [w, x, y, z] format
	return [q.w, q.x, q.y, q.z];
}

// Calibration data storage
const calibrationData = {
	tPoseQuaternions: {},
	isCalibrated: false
};

/**
 * Store current sensor readings as T-pose calibration
 * @param {Object} sensorData - Current sensor data
 * @returns {Object} - Captured calibration quaternions
 */
export function storeTposeCalibration(sensorData) {
	// Extract quaternions for each body part
	const sensors = getSensorsWithData(sensorData);

	calibrationData.tPoseQuaternions = {};
	calibrationData.isCalibrated = sensors.length > 0;

	console.log(`Capturing T-pose with ${sensors.length} sensors`);

	// Create a map to ensure we get the latest data for each body part
	const latestSensorData = {};

	sensors.forEach((sensor) => {
		if (sensor.bodyPart && Array.isArray(sensor.data) && sensor.data.length === 4) {
			// Verify the quaternion is valid
			if (!sensor.data.some(isNaN)) {
				latestSensorData[sensor.bodyPart] = [...sensor.data];
				console.log(`Stored T-pose for ${sensor.bodyPart}: [${sensor.data.join(', ')}]`);
			} else {
				console.warn(`Invalid quaternion data for ${sensor.bodyPart}`);
			}
		}
	});

	// Store the latest data for each body part
	Object.keys(latestSensorData).forEach((bodyPart) => {
		calibrationData.tPoseQuaternions[bodyPart] = latestSensorData[bodyPart];
	});

	return calibrationData.tPoseQuaternions;
}

/**
 * Check if calibration data exists
 * @returns {Boolean} - Whether system is calibrated
 */
export function isCalibrated() {
	return calibrationData.isCalibrated;
}

/**
 * Apply calibration to a quaternion
 * @param {Array} quaternionData - Quaternion to calibrate [w, x, y, z]
 * @param {String} bodyPart - Body part identifier
 * @returns {Promise<Array>} - Calibrated quaternion
 */
export async function applyCalibration(quaternionData, bodyPart) {
	if (!calibrationData.isCalibrated || !calibrationData.tPoseQuaternions[bodyPart]) {
		return quaternionData;
	}

	const THREE = await getTHREE();

	// Get the inverse of the T-pose quaternion for this body part
	const tPoseQ = calibrationData.tPoseQuaternions[bodyPart];

	// Create quaternion from the T-pose data
	const tPoseQuaternion = new THREE.Quaternion(
		tPoseQ[1], // x
		tPoseQ[2], // y
		tPoseQ[3], // z
		tPoseQ[0] // w
	).normalize();

	// Compute inverse (conjugate) of T-pose quaternion
	const invTpose = tPoseQuaternion.clone().invert();

	// Create quaternion from the input data
	const inputQ = new THREE.Quaternion(
		quaternionData[1], // x
		quaternionData[2], // y
		quaternionData[3], // z
		quaternionData[0] // w
	).normalize();

	// Apply the inverse T-pose quaternion to the input quaternion
	// This effectively gives us the "delta" from T-pose
	// q_result = q_input * q_tpose_inverse (right multiply)
	const resultQ = new THREE.Quaternion().multiplyQuaternions(inputQ, invTpose);

	// Return as array in [w, x, y, z] format
	return [resultQ.w, resultQ.x, resultQ.y, resultQ.z];
}

/**
 * Adjust a specific correction parameter
 * @param {String} bodyPart - Body part to adjust
 * @param {String} property - Property to adjust ('rotationCorrection' or 'axisInversion')
 * @param {Number} axis - Axis index (0=X, 1=Y, 2=Z)
 * @param {Number} value - New value
 * @returns {Boolean} - Success
 */
export function adjustCorrection(bodyPart, property, axis, value) {
	if (!userCorrections[bodyPart]) {
		console.warn(`No correction exists for body part: ${bodyPart}`);
		return false;
	}

	if (property === 'rotationCorrection' || property === 'axisInversion') {
		if (axis >= 0 && axis <= 2) {
			userCorrections[bodyPart][property][axis] = value;
			return true;
		}
	}

	return false;
}

/**
 * Get current corrections for UI display or debug
 * @returns {Object} - Copy of current corrections
 */
export function getCurrentCorrections() {
	return JSON.parse(JSON.stringify(userCorrections));
}
