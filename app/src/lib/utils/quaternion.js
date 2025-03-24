/**
 * Utility functions for working with quaternions from the motion capture system
 */

/**
 * Convert quaternion to Euler angles (in degrees)
 * @param {Array} quaternion - [w, x, y, z] quaternion
 * @returns {Object} Euler angles in degrees {x, y, z}
 */
export function quaternionToEuler(quaternion) {
	const [w, x, y, z] = quaternion;

	// Roll (x-axis rotation)
	const sinr_cosp = 2 * (w * x + y * z);
	const cosr_cosp = 1 - 2 * (x * x + y * y);
	const roll = Math.atan2(sinr_cosp, cosr_cosp);

	// Pitch (y-axis rotation)
	const sinp = 2 * (w * y - z * x);
	let pitch;
	if (Math.abs(sinp) >= 1) {
		// Use 90 degrees if out of range
		pitch = (Math.sign(sinp) * Math.PI) / 2;
	} else {
		pitch = Math.asin(sinp);
	}

	// Yaw (z-axis rotation)
	const siny_cosp = 2 * (w * z + x * y);
	const cosy_cosp = 1 - 2 * (y * y + z * z);
	const yaw = Math.atan2(siny_cosp, cosy_cosp);

	// Convert to degrees
	return {
		x: (roll * 180) / Math.PI,
		y: (pitch * 180) / Math.PI,
		z: (yaw * 180) / Math.PI
	};
}

/**
 * Normalize a quaternion to unit length
 * @param {Array} quaternion - [w, x, y, z] quaternion
 * @returns {Array} Normalized quaternion
 */
export function normalizeQuaternion(quaternion) {
	const [w, x, y, z] = quaternion;
	const len = Math.sqrt(w * w + x * x + y * y + z * z);

	if (len === 0) {
		return [1, 0, 0, 0]; // Default identity quaternion
	}

	return [w / len, x / len, y / len, z / len];
}

/**
 * Multiply two quaternions together
 * @param {Array} q1 - First quaternion [w, x, y, z]
 * @param {Array} q2 - Second quaternion [w, x, y, z]
 * @returns {Array} Result quaternion
 */
export function multiplyQuaternions(q1, q2) {
	const [w1, x1, y1, z1] = q1;
	const [w2, x2, y2, z2] = q2;

	return [
		w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
		w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
		w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
		w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2
	];
}

/**
 * Get the conjugate of a quaternion (inverse if normalized)
 * @param {Array} quaternion - [w, x, y, z] quaternion
 * @returns {Array} Conjugate quaternion
 */
export function conjugateQuaternion(quaternion) {
	const [w, x, y, z] = quaternion;
	return [w, -x, -y, -z];
}

/**
 * Interpolate between two quaternions (SLERP)
 * @param {Array} q1 - Start quaternion [w, x, y, z]
 * @param {Array} q2 - End quaternion [w, x, y, z]
 * @param {Number} t - Interpolation factor (0-1)
 * @returns {Array} Interpolated quaternion
 */
export function slerpQuaternions(q1, q2, t) {
	// Normalize inputs
	const qa = normalizeQuaternion(q1);
	const qb = normalizeQuaternion(q2);

	// Calculate cosine of angle between quaternions
	let cosHalfTheta = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];

	// If qa=qb or qa=-qb, do simple linear interpolation
	if (Math.abs(cosHalfTheta) >= 1.0) {
		return [...qa];
	}

	// If quaternions are in opposite hemispheres, negate one
	let qbNeg = [...qb];
	if (cosHalfTheta < 0) {
		qbNeg = qbNeg.map((x) => -x);
		cosHalfTheta = -cosHalfTheta;
	}

	// Calculate interpolation factors
	const halfTheta = Math.acos(cosHalfTheta);
	const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

	// If angle is close to 0, do linear interpolation
	if (Math.abs(sinHalfTheta) < 0.001) {
		return [
			qa[0] * 0.5 + qbNeg[0] * 0.5,
			qa[1] * 0.5 + qbNeg[1] * 0.5,
			qa[2] * 0.5 + qbNeg[2] * 0.5,
			qa[3] * 0.5 + qbNeg[3] * 0.5
		];
	}

	// Calculate SLERP
	const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
	const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

	return [
		qa[0] * ratioA + qbNeg[0] * ratioB,
		qa[1] * ratioA + qbNeg[1] * ratioB,
		qa[2] * ratioA + qbNeg[2] * ratioB,
		qa[3] * ratioA + qbNeg[3] * ratioB
	];
}

/**
 * Apply quaternion to rotate a 3D vector
 * @param {Array} quaternion - [w, x, y, z] quaternion
 * @param {Array} vector - [x, y, z] vector
 * @returns {Array} Rotated vector [x, y, z]
 */
export function rotateVector(quaternion, vector) {
	// Create a quaternion representing the vector (with w=0)
	const vecQuat = [0, vector[0], vector[1], vector[2]];

	// q * v * q^-1
	const qConj = conjugateQuaternion(quaternion);
	const temp = multiplyQuaternions(quaternion, vecQuat);
	const rotated = multiplyQuaternions(temp, qConj);

	// Return just the vector part
	return [rotated[1], rotated[2], rotated[3]];
}
