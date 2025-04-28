import { getTHREE } from './engine.js';
import { findMatchingBone, getSensorsWithData, boneNamePatterns } from '$lib/motion/sensors.js';
import * as motionStore from '$lib/stores/motionStore.js';

// Update the updateModelWithSensorData function
export async function updateModelWithSensorData(context, sensorData, modelType = 'basic') {
	if (!context || !context.model || !sensorData) {
		if (motionStore.debugMode) {
			console.log('Model update failed - missing required data:', {
				hasContext: !!context,
				hasModel: !!(context && context.model),
				hasSensorData: !!sensorData
			});
		}
		return false;
	}

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

	// Add debugging for issues
	if (motionStore.debugMode && sensorData.sequence && sensorData.sequence % 100 === 0) {
		const sensorCount = Object.keys(sensorData).filter((k) => k.startsWith('S')).length;
		console.log(`Model update for ${modelType}: ${updatedAny ? 'SUCCESS' : 'FAILED'}`);
		console.log(`Sensor data: ${sensorCount} sensors, sequence: ${sensorData.sequence}`);

		if (!updatedAny && sensorCount > 0) {
			// This indicates we have data but couldn't match it to model parts
			console.log('Model bone mapping issue - check bone names and sensor mapping');
		}
	}

	return updatedAny;
}

async function updateBasicModel(context, sensorData, THREE) {
	if (!context.basicModelParts) {
		if (motionStore.debugMode) console.log('Basic model parts not initialized');
		return false;
	}

	const sensors = getSensorsWithData(sensorData);
	let updatedAny = false;

	if (sensors.length === 0) {
		if (motionStore.debugMode) console.log('No sensor data available for basic model update');
		return false;
	}

	const partsUpdated = [];

	for (const sensor of sensors) {
		// Convert bodyPart to the property name used in basicModelParts
		// e.g. "RightUpperArm" to "rightUpperArm"
		const bodyPart = sensor.bodyPart;
		if (!bodyPart) continue;

		const partName = bodyPart.charAt(0).toLowerCase() + bodyPart.slice(1);
		const part = context.basicModelParts[partName];

		if (part && sensor.data) {
			if (Array.isArray(sensor.data) && sensor.data.length === 4) {
				// Validate quaternion data
				if (
					isNaN(sensor.data[0]) ||
					isNaN(sensor.data[1]) ||
					isNaN(sensor.data[2]) ||
					isNaN(sensor.data[3])
				) {
					if (motionStore.debugMode)
						console.warn(`Invalid quaternion data for ${bodyPart}:`, sensor.data);
					continue;
				}

				// Create THREE.js quaternion from sensor data
				const q = new THREE.Quaternion(
					sensor.data[1], // x
					sensor.data[2], // y
					sensor.data[3], // z
					sensor.data[0] // w
				);

				// Normalize quaternion
				q.normalize();

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

				// Ensure matrices are updated
				part.joint.updateMatrix();
				part.joint.updateMatrixWorld(true);
				part.limb.updateMatrix();
				part.limb.updateMatrixWorld(true);

				partsUpdated.push(partName);
				updatedAny = true;
			}
		}
	}

	// Debug logging
	if (motionStore.debugMode && sensorData.sequence % 100 === 0) {
		if (partsUpdated.length > 0) {
			console.log(`Basic model updated ${partsUpdated.length} parts:`, partsUpdated);
		} else {
			console.warn('No basic model parts updated despite having sensor data');
			console.log('Available parts:', Object.keys(context.basicModelParts).join(', '));
			console.log('Sensor body parts:', sensors.map((s) => s.bodyPart).join(', '));
		}
	}

	return updatedAny;
}

async function updateGLTFModel(context, sensorData, THREE) {
	const sensors = getSensorsWithData(sensorData);
	const bonesFound = new Set();
	let updatedAny = false;

	if (sensors.length === 0) {
		if (motionStore.debugMode) console.log('No sensor data available for model update');
		return false;
	}

	// Output model bone structure on first run or when needed
	if (motionStore.debugMode && (!context.bonesLogged || sensorData.sequence % 500 === 0)) {
		console.log('Analyzing model bone structure:');
		const allBones = [];
		context.model.traverse((obj) => {
			if (obj.isBone || obj.type === 'Bone') {
				allBones.push(obj.name);
			}
		});
		console.log('Available bones:', allBones);

		// Mark as logged to avoid spamming
		context.bonesLogged = true;

		// Also log available sensors to help diagnose mapping issues
		console.log('Available sensors:');
		sensors.forEach((sensor) => {
			console.log(`- Sensor ${sensor.index} -> ${sensor.bodyPart || 'unmapped'}`);
		});

		// Show mapping attempts for each sensor
		console.log('Attempting to map sensors to bones:');
		sensors.forEach((sensor) => {
			if (!sensor.bodyPart) {
				console.log(`Sensor ${sensor.index}: No body part mapping!`);
				return;
			}

			const patterns = boneNamePatterns[sensor.bodyPart] || [sensor.bodyPart];
			console.log(`Sensor ${sensor.index} (${sensor.bodyPart}): Looking for patterns:`, patterns);

			// Check which bones would match
			const matchingBones = [];
			context.model.traverse((obj) => {
				if ((obj.isBone || obj.type === 'Bone') && findMatchingBone(obj, sensor.bodyPart)) {
					matchingBones.push(obj.name);
				}
			});

			if (matchingBones.length) {
				console.log(`  Found matches:`, matchingBones);
			} else {
				console.log(`  NO MATCHING BONES FOUND!`);
			}
		});
	}

	// If we have a model with bones, try to find and update them
	context.model.traverse((object) => {
		if (object.isBone || object.type === 'Bone') {
			for (const sensor of sensors) {
				if (sensor.bodyPart && findMatchingBone(object, sensor.bodyPart)) {
					if (
						motionStore.debugMode &&
						!bonesFound.has(sensor.bodyPart) &&
						sensorData.sequence % 100 === 0
					) {
						console.log(`Updating bone "${object.name}" with data from "${sensor.bodyPart}"`);
					}

					bonesFound.add(sensor.bodyPart);

					if (Array.isArray(sensor.data) && sensor.data.length === 4) {
						// Make sure quaternion is valid before applying
						if (
							!isNaN(sensor.data[0]) &&
							!isNaN(sensor.data[1]) &&
							!isNaN(sensor.data[2]) &&
							!isNaN(sensor.data[3])
						) {
							// Apply quaternion with correct order [w,x,y,z]
							object.quaternion.set(
								sensor.data[1], // x
								sensor.data[2], // y
								sensor.data[3], // z
								sensor.data[0] // w
							);

							// Normalize quaternion to prevent drift
							object.quaternion.normalize();

							// Ensure object matrix is updated
							object.updateMatrix();
							object.updateMatrixWorld(true);

							updatedAny = true;
						} else {
							if (motionStore.debugMode)
								console.warn(`Invalid quaternion data for ${sensor.bodyPart}:`, sensor.data);
						}
					}
				}
			}
		}
	});

	// Log bones found in debug mode
	if (motionStore.debugMode && sensorData.sequence % 100 === 0) {
		const missingSensors = sensors
			.filter((s) => s.bodyPart && !bonesFound.has(s.bodyPart))
			.map((s) => s.bodyPart);

		if (missingSensors.length > 0) {
			console.warn('Missing bones for sensors:', missingSensors);

			// Help diagnose by listing all bone names in the model
			if (missingSensors.length === sensors.length) {
				console.log('Listing all bones in model for debugging:');
				const allBones = [];
				context.model.traverse((obj) => {
					if (obj.isBone || obj.type === 'Bone') {
						allBones.push(obj.name);
					}
				});
				console.log('Model bones:', allBones);
			}
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
