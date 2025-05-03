import { getTHREE } from '../three/engine.js';
import { getSensorsWithData } from './sensors.js';

export const DEFAULT_CORRECTIONS = {
	RightUpperArm: {
		rotationCorrection: [0, 90, 180],
		axisInversion: [0, 0, 0]
	},
	RightLowerArm: {
		rotationCorrection: [0, 90, 180],
		axisInversion: [0, 0, 0]
	},
	LeftUpperArm: {
		rotationCorrection: [0, -90, 180],
		axisInversion: [0, 0, 0]
	},
	LeftLowerArm: {
		rotationCorrection: [0, -90, 180],
		axisInversion: [0, 0, 0]
	},
	RightUpperLeg: {
		rotationCorrection: [90, 0, 0],
		axisInversion: [0, 0, 0]
	},
	RightLowerLeg: {
		rotationCorrection: [90, 0, 0],
		axisInversion: [0, 0, 0]
	},
	LeftUpperLeg: {
		rotationCorrection: [90, 0, 0],
		axisInversion: [0, 0, 0]
	},
	LeftLowerLeg: {
		rotationCorrection: [90, 0, 0],
		axisInversion: [0, 0, 0]
	}
};

export const userCorrections = {};

export function initializeCorrections() {
	Object.keys(DEFAULT_CORRECTIONS).forEach((key) => {
		userCorrections[key] = JSON.parse(JSON.stringify(DEFAULT_CORRECTIONS[key]));
	});
}

export function resetCorrections() {
	initializeCorrections();
}

initializeCorrections();

export async function correctQuaternion(quaternionData, bodyPart) {
	if (!quaternionData || !bodyPart) return quaternionData;

	const THREE = await getTHREE();

	const correction = userCorrections[bodyPart];
	if (!correction) {
		console.warn(`No correction data for ${bodyPart}`);
		return quaternionData;
	}

	const q = new THREE.Quaternion(
		quaternionData[1], // x
		quaternionData[2], // y
		quaternionData[3], // z
		quaternionData[0] // w
	);

	q.normalize();

	if (correction.rotationCorrection) {
		const correctionEuler = new THREE.Euler(
			(correction.rotationCorrection[0] * Math.PI) / 180,
			(correction.rotationCorrection[1] * Math.PI) / 180,
			(correction.rotationCorrection[2] * Math.PI) / 180,
			'XYZ'
		);
		const correctionQuaternion = new THREE.Quaternion().setFromEuler(correctionEuler);

		q.premultiply(correctionQuaternion);
	}

	if (
		correction.axisInversion &&
		(correction.axisInversion[0] || correction.axisInversion[1] || correction.axisInversion[2])
	) {
		const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ');

		if (correction.axisInversion[0]) euler.x = -euler.x;
		if (correction.axisInversion[1]) euler.y = -euler.y;
		if (correction.axisInversion[2]) euler.z = -euler.z;

		q.setFromEuler(euler);
	}

	return [q.w, q.x, q.y, q.z];
}

const calibrationData = {
	tPoseQuaternions: {},
	isCalibrated: false
};

export function storeTposeCalibration(sensorData) {
	const sensors = getSensorsWithData(sensorData);

	console.log(
		`Raw sensor data for T-pose calibration:`,
		Object.keys(sensorData).filter((k) => k.startsWith('S')).length + ' sensors'
	);

	calibrationData.tPoseQuaternions = {};
	calibrationData.isCalibrated = false;
	calibrationData.tPoseTimestamp = new Date();

	if (sensors.length === 0) {
		console.error('No valid sensors found for T-pose calibration');
		return {};
	}

	console.log(`Processing T-pose with ${sensors.length} sensors`);

	const correctionPromises = sensors.map(async (sensor) => {
		if (sensor.bodyPart && Array.isArray(sensor.data) && sensor.data.length === 4) {
			if (!sensor.data.some(isNaN)) {
				try {
					const correctedData = await correctQuaternion(sensor.data, sensor.bodyPart);

					calibrationData.tPoseQuaternions[sensor.bodyPart] = [...correctedData];

					console.log(
						`✓ Stored T-pose for ${sensor.bodyPart} (sensor S${sensor.index}): [${correctedData.join(', ')}]`
					);
					return true;
				} catch (error) {
					console.error(`Error correcting quaternion for ${sensor.bodyPart}:`, error);
					return false;
				}
			} else {
				console.warn(`⚠ Invalid quaternion data for ${sensor.bodyPart}: ${sensor.data}`);
				return false;
			}
		} else {
			console.warn(`⚠ Sensor ${sensor.index} has invalid data or no body part mapping`);
			return false;
		}
	});

	Promise.all(correctionPromises).then((results) => {
		const successCount = results.filter(Boolean).length;
		if (successCount > 0) {
			calibrationData.isCalibrated = true;
			console.log(
				`✓ T-pose calibration complete with ${successCount}/${sensors.length} body parts`
			);
		} else {
			console.error('❌ T-pose calibration failed - no valid quaternions captured');
		}
	});

	return calibrationData.tPoseQuaternions;
}

export function isCalibrated() {
	return calibrationData.isCalibrated;
}

export async function applyCalibration(quaternionData, bodyPart) {
	if (!calibrationData.isCalibrated || !calibrationData.tPoseQuaternions[bodyPart]) {
		return quaternionData;
	}

	const THREE = await getTHREE();

	const tPoseQ = calibrationData.tPoseQuaternions[bodyPart];

	const tPoseQuaternion = new THREE.Quaternion(
		tPoseQ[1], // x
		tPoseQ[2], // y
		tPoseQ[3], // z
		tPoseQ[0] // w
	).normalize();

	const invTpose = tPoseQuaternion.clone().invert();

	const inputQ = new THREE.Quaternion(
		quaternionData[1], // x
		quaternionData[2], // y
		quaternionData[3], // z
		quaternionData[0] // w
	).normalize();

	const resultQ = new THREE.Quaternion().multiplyQuaternions(inputQ, invTpose);

	return [resultQ.w, resultQ.x, resultQ.y, resultQ.z];
}

export function getCalibrationStatus() {
	return {
		isCalibrated: calibrationData.isCalibrated,
		calibratedParts: Object.keys(calibrationData.tPoseQuaternions),
		timestamp: calibrationData.tPoseTimestamp
	};
}

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

export function getCurrentCorrections() {
	return JSON.parse(JSON.stringify(userCorrections));
}
