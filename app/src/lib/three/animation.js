import { getTHREE } from './engine.js';
import { findMatchingBone, getSensorsWithData } from '$lib/motion/sensors.js';
import * as motionStore from '$lib/stores/motionStore.js';

// Update model with sensor data
export async function updateModelWithSensorData(context, sensorData, modelType = 'basic') {
	if (!context || !context.model || !sensorData) return false;

	const THREE = await getTHREE();
	let updatedAny = false;

	if (modelType === 'basic') {
		updatedAny = await updateBasicModel(context, sensorData, THREE);
	} else {
		updatedAny = await updateGLTFModel(context, sensorData, THREE);
	}

	// Update skeleton helper if bones were updated
	if (updatedAny && context.skeleton) {
		context.skeleton.update();
	}

	return updatedAny;
}

// Update basic model with sensor data
async function updateBasicModel(context, sensorData, THREE) {
	if (!context.basicModelParts) return false;

	const sensors = getSensorsWithData(sensorData);
	let updatedAny = false;

	for (const sensor of sensors) {
		const partName = sensor.bodyPart?.charAt(0).toLowerCase() + sensor.bodyPart?.slice(1);
		const part = context.basicModelParts[partName];

		if (part && sensor.data) {
			// Create THREE.js quaternion from sensor data
			const q = new THREE.Quaternion(
				sensor.data[1], // x
				sensor.data[2], // y
				sensor.data[3], // z
				sensor.data[0] // w
			);

			// Apply quaternion to joint
			part.joint.quaternion.copy(q);

			// Update limb orientation
			const direction = new THREE.Vector3(0, -1, 0).applyQuaternion(q);

			// Position limb to connect from joint
			const midpoint = new THREE.Vector3()
				.copy(part.joint.position)
				.add(direction.clone().multiplyScalar(20)); // Half the limb length

			part.limb.position.copy(midpoint);

			// Rotate limb to align with direction
			part.limb.quaternion.setFromUnitVectors(
				new THREE.Vector3(0, 1, 0),
				direction.clone().negate()
			);

			updatedAny = true;
		}
	}

	return updatedAny;
}

// Update GLTF model with sensor data
async function updateGLTFModel(context, sensorData, THREE) {
	const sensors = getSensorsWithData(sensorData);
	const bonesFound = new Set();
	let updatedAny = false;

	// If we have a model with bones, try to find and update them
	context.model.traverse((object) => {
		if (object.isBone || object.type === 'Bone') {
			for (const sensor of sensors) {
				if (sensor.bodyPart && findMatchingBone(object, sensor.bodyPart)) {
					if (motionStore.debugMode && !bonesFound.has(sensor.bodyPart)) {
						console.log(`Found bone "${object.name}" matching "${sensor.bodyPart}"`);
					}

					bonesFound.add(sensor.bodyPart);

					if (Array.isArray(sensor.data) && sensor.data.length === 4) {
						// Apply quaternion
						object.quaternion.set(
							sensor.data[1], // x
							sensor.data[2], // y
							sensor.data[3], // z
							sensor.data[0] // w
						);
						updatedAny = true;
					}
				}
			}
		}
	});

	// Log bones found in debug mode
	if (motionStore.debugMode) {
		const missingSensors = sensors
			.filter((s) => s.bodyPart && !bonesFound.has(s.bodyPart))
			.map((s) => s.bodyPart);

		if (missingSensors.length > 0) {
			console.log('Missing bones for sensors:', missingSensors);
		}
	}

	return updatedAny;
}

// Set visibility of skeleton helper
export function setSkeletonVisibility(context, visible) {
	if (context && context.skeleton) {
		context.skeleton.visible = visible;
	}
}

// Reset model to default pose
export async function resetModelPose(context) {
	if (!context || !context.model) return;

	const THREE = await getTHREE();

	if (context.mixer) {
		// Stop all current animations
		context.mixer.stopAllAction();

		// Find T-pose or idle animation if available
		const clip = context.model.animations?.find(
			(a) =>
				a.name.toLowerCase().includes('t-pose') ||
				a.name.toLowerCase().includes('idle') ||
				a.name.toLowerCase().includes('bind')
		);

		if (clip) {
			const action = context.mixer.clipAction(clip);
			action.reset().play();
		}
	} else {
		// For basic model, reset all quaternions
		context.model.traverse((obj) => {
			if (obj.quaternion) {
				obj.quaternion.set(0, 0, 0, 1);
			}
		});
	}
}
