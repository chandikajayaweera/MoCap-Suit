/* eslint-disable no-unused-vars */
// Enhanced animation system for sensor data visualization
import { getTHREE } from './engine.js';
import { findMatchingBone, getSensorsWithData, boneNamePatterns } from '$lib/motion/sensors.js';
import * as motionStore from '$lib/stores/motionStore.js';
import { correctQuaternion, applyCalibration, isCalibrated } from '$lib/motion/transform.js';

// Animation mapping registry
const AnimationSystem = {
	// Track model-specific bone mappings for reuse
	boneMappings: new Map(),

	// Track debugging state
	debugCounter: 0,

	// Reset the animation system
	reset() {
		this.boneMappings.clear();
		this.debugCounter = 0;
	}
};

/**
 * Update model with sensor data - main entry point for all model updates
 * @param {Object} context - Scene context with model reference
 * @param {Object} sensorData - Sensor data with quaternions
 * @param {string} modelType - Type of model ('basic' or loaded model)
 * @returns {Promise<boolean>} - Whether any updates were applied
 */
export async function updateModelWithSensorData(context, sensorData, modelType = 'basic') {
	// Validate inputs
	if (!context || !context.model || !sensorData) {
		let debugEnabled = false;

		try {
			const unsubscribe = motionStore.debugMode.subscribe((value) => {
				debugEnabled = value;
			});
			unsubscribe();
		} catch (err) {
			// Silent fail
		}

		if (debugEnabled) {
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

	// Increment debug counter to limit logging frequency
	AnimationSystem.debugCounter = (AnimationSystem.debugCounter + 1) % 100;

	try {
		if (modelType === 'basic') {
			updatedAny = await updateBasicModel(context, sensorData, THREE);
		} else {
			updatedAny = await updateGLTFModel(context, sensorData, THREE);
		}

		// Update skeleton helper if bones were updated
		if (updatedAny && context.skeleton) {
			// Check if update method exists before calling it
			if (typeof context.skeleton.update === 'function') {
				context.skeleton.update();
			} else if (AnimationSystem.debugCounter === 1) {
				// Log warning only occasionally to avoid console spam
				console.warn(
					'context.skeleton exists but does not have an update method. Is it a THREE.SkeletonHelper and initialized correctly?',
					context.skeleton
				);
			}
		}

		// Add debugging for issues
		let debugEnabled = false;

		try {
			const unsubscribe = motionStore.debugMode.subscribe((value) => {
				debugEnabled = value;
			});
			unsubscribe();
		} catch (err) {
			// Silent fail
		}

		if (debugEnabled && sensorData.sequence && sensorData.sequence % 100 === 0) {
			const sensorCount = Object.keys(sensorData).filter((k) => k.startsWith('S')).length;
			console.log(`Model update for ${modelType}: ${updatedAny ? 'SUCCESS' : 'FAILED'}`);
			console.log(`Sensor data: ${sensorCount} sensors, sequence: ${sensorData.sequence}`);

			if (!updatedAny && sensorCount > 0) {
				// This indicates we have data but couldn't match it to model parts
				console.log('Model bone mapping issue - check bone names and sensor mapping');

				// Force regenerate bone mapping on next update
				if (modelType !== 'basic') {
					const modelId = context.model.uuid || 'unknown';
					AnimationSystem.boneMappings.delete(modelId);
					console.log(`Reset bone mapping for model ${modelId} for next update attempt`);
				}
			}
		}

		return updatedAny;
	} catch (error) {
		console.error(`Error updating model (${modelType}) with sensor data:`, error);
		return false;
	}
}

/**
 * Update a basic model with sensor data
 * @param {Object} context - Scene context with model reference
 * @param {Object} sensorData - Sensor data with quaternions
 * @param {Object} THREE - THREE.js library
 * @returns {Promise<boolean>} - Whether any updates were applied
 */
async function updateBasicModel(context, sensorData, THREE) {
	if (!context.basicModelParts || typeof context.basicModelParts !== 'object') {
		if (AnimationSystem.debugCounter === 1) {
			console.warn('updateBasicModel: context.basicModelParts is missing or not an object.');
		}
		return false;
	}

	const sensors = getSensorsWithData(sensorData);
	let updatedAny = false;

	if (sensors.length === 0) {
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

		if (part && part.joint && part.limb && sensor.data) {
			if (Array.isArray(sensor.data) && sensor.data.length === 4) {
				// Validate quaternion data
				if (
					isNaN(sensor.data[0]) ||
					isNaN(sensor.data[1]) ||
					isNaN(sensor.data[2]) ||
					isNaN(sensor.data[3])
				) {
					continue;
				}

				try {
					// Apply transformations to the quaternion data
					let transformedData = await correctQuaternion(sensor.data, sensor.bodyPart);

					// Apply calibration if available
					if (isCalibrated()) {
						transformedData = await applyCalibration(transformedData, sensor.bodyPart);
					}

					// Create THREE.js quaternion from transformed data
					const q = new THREE.Quaternion(
						transformedData[1], // x
						transformedData[2], // y
						transformedData[3], // z
						transformedData[0] // w
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
				} catch (error) {
					if (AnimationSystem.debugCounter === 1) {
						console.error(`Error updating basic model part ${partName}:`, error);
					}
				}
			}
		}
	}

	// Debug logging only occasionally
	let debugEnabled = false;
	try {
		const unsubscribe = motionStore.debugMode.subscribe((value) => {
			debugEnabled = value;
		});
		unsubscribe();
	} catch (err) {
		// Silent fail
	}

	if (debugEnabled && AnimationSystem.debugCounter === 0 && sensors.length > 0) {
		console.log(`Basic model updated ${partsUpdated.length}/${sensors.length} parts`);
	}

	return updatedAny;
}

/**
 * Update a GLTF model with sensor data
 * @param {Object} context - Scene context with model reference
 * @param {Object} sensorData - Sensor data with quaternions
 * @param {Object} THREE - THREE.js library
 * @returns {Promise<boolean>} - Whether any updates were applied
 */
async function updateGLTFModel(context, sensorData, THREE) {
	const sensors = getSensorsWithData(sensorData);
	const bonesFound = new Set();
	let updatedAny = false;

	if (sensors.length === 0) {
		return false;
	}

	// Build or retrieve bone mapping for this model
	const modelId = context.model.uuid || 'unknown';
	let boneMapping = AnimationSystem.boneMappings.get(modelId);

	if (!boneMapping) {
		boneMapping = buildBoneMapping(context.model);
		AnimationSystem.boneMappings.set(modelId, boneMapping);

		// Log bone mapping on first creation
		if (Object.keys(boneMapping).length > 0) {
			console.log(
				`Built bone mapping for model ${modelId}: ${Object.keys(boneMapping).length} body parts mapped.`
			);
		} else {
			console.warn(
				`Failed to build any bone mappings for model ${modelId}. Check bone names and patterns.`
			);
		}
	}

	// Check if this is the first time we're processing this model
	let debugEnabled = false;

	try {
		const unsubscribe = motionStore.debugMode.subscribe((value) => {
			debugEnabled = value;
		});
		unsubscribe();
	} catch (err) {
		// Silent fail
	}

	const shouldLogBones =
		debugEnabled &&
		(!context.bonesLogged || (sensorData.sequence && sensorData.sequence % 500 === 0));

	if (shouldLogBones) {
		logModelBoneStructure(context, sensors, boneMapping);
		context.bonesLogged = true;
	}

	// Use the pre-built mapping for efficiency
	for (const sensor of sensors) {
		if (!sensor.bodyPart) continue;

		const matchingBones = boneMapping[sensor.bodyPart];
		if (!matchingBones || matchingBones.length === 0) continue;

		bonesFound.add(sensor.bodyPart);

		// Validate sensor quaternion data
		if (!Array.isArray(sensor.data) || sensor.data.length !== 4 || sensor.data.some(isNaN)) {
			continue;
		}

		try {
			// Apply transformations to the quaternion data
			let transformedData = await correctQuaternion(sensor.data, sensor.bodyPart);

			// Apply calibration if available
			if (isCalibrated()) {
				transformedData = await applyCalibration(transformedData, sensor.bodyPart);
			}

			// Create quaternion from transformed data
			const q = new THREE.Quaternion(
				transformedData[1], // x
				transformedData[2], // y
				transformedData[3], // z
				transformedData[0] // w
			).normalize();

			// Update all mapped bones with this quaternion
			for (const boneInfo of matchingBones) {
				if (!boneInfo.bone) continue;

				// Apply quaternion to bone
				boneInfo.bone.quaternion.copy(q);

				// Update matrices
				boneInfo.bone.updateMatrix();
				boneInfo.bone.updateMatrixWorld(true);

				updatedAny = true;
			}
		} catch (error) {
			if (debugEnabled && AnimationSystem.debugCounter === 1) {
				console.error(`Error applying quaternion for ${sensor.bodyPart}:`, error);
			}
		}
	}

	// Log any missing mappings
	if (debugEnabled && shouldLogBones) {
		const missingSensors = sensors
			.filter((s) => s.bodyPart && !bonesFound.has(s.bodyPart))
			.map((s) => s.bodyPart);

		if (missingSensors.length > 0) {
			console.warn('Missing bones for sensors:', missingSensors);
		}
	}

	return updatedAny;
}

/**
 * Build an efficient mapping between body parts and bones in the model
 * @param {Object} model - The 3D model
 * @returns {Object} - Mapping of body parts to bones
 */
function buildBoneMapping(model) {
	const mapping = {};
	const allBones = [];

	// Find all bones in the model
	model.traverse((object) => {
		// Check if object is a bone using safe property access
		if ('isBone' in object && object.isBone) {
			allBones.push(object);
		}
	});

	if (allBones.length === 0) {
		console.warn('No bones found in model. Cannot map sensors to skeleton.');
		return mapping;
	}

	// For each known body part, find all matching bones
	Object.keys(boneNamePatterns).forEach((bodyPart) => {
		mapping[bodyPart] = [];

		allBones.forEach((bone) => {
			if (findMatchingBone(bone, bodyPart)) {
				mapping[bodyPart].push({
					bone: bone,
					name: bone.name
				});
			}
		});
	});

	// Log mapping summary
	const mappedParts = Object.keys(mapping).filter((key) => mapping[key].length > 0).length;
	console.log(
		`Bone mapping: ${mappedParts}/${Object.keys(boneNamePatterns).length} body parts mapped to ${allBones.length} bones`
	);

	return mapping;
}

/**
 * Log detailed information about the model's bone structure
 * @param {Object} context - Scene context with model
 * @param {Array} sensors - Array of sensor data
 * @param {Object} boneMapping - Mapping of body parts to bones
 */
function logModelBoneStructure(context, sensors, boneMapping) {
	console.log('Analyzing model bone structure:');
	const allBones = [];

	context.model.traverse((obj) => {
		if ('isBone' in obj && obj.isBone) {
			allBones.push(obj.name);
		}
	});

	console.log('Available bones:', allBones);

	// Log available sensors
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

		// Get matching bones from mapping
		const matchingBones = boneMapping[sensor.bodyPart] || [];
		const boneNames = matchingBones.map((b) => b.name);

		if (boneNames.length) {
			console.log(`  Found matches:`, boneNames);
		} else {
			console.log(`  NO MATCHING BONES FOUND!`);
		}
	});
}

/**
 * Set visibility of skeleton helper
 * @param {Object} context - Scene context with skeleton
 * @param {boolean} visible - Whether the skeleton should be visible
 */
export function setSkeletonVisibility(context, visible) {
	if (context && context.skeleton) {
		context.skeleton.visible = !!visible;
	}
}

/**
 * Reset model to default pose
 * @param {Object} context - Scene context with model
 * @returns {Promise<boolean>} - Whether reset was successful
 */
export async function resetModelPose(context) {
	if (!context || !context.model) return false;

	try {
		if (context.mixer) {
			// Stop all current animations
			context.mixer.stopAllAction();

			// Find T-pose or idle animation if available
			const animations = context.model.animations || [];
			const resetPoseNames = ['tpose', 't-pose', 'bind', 'idle', 'rest'];

			let resetClip = animations.find((a) =>
				resetPoseNames.some((name) => a.name.toLowerCase().includes(name))
			);

			if (resetClip) {
				const action = context.mixer.clipAction(resetClip);
				action.reset().play();
				console.log(`Reset pose using animation: ${resetClip.name}`);
			} else if (animations.length > 0) {
				const action = context.mixer.clipAction(animations[0]);
				action.reset().play();
				console.log(`Reset pose using first animation: ${animations[0].name}`);
			} else {
				// Reset manually if no animations
				resetManually(context.model);
			}
		} else {
			// For basic model, reset all quaternions
			resetManually(context.model);
		}

		// Reset cache to ensure fresh mappings
		AnimationSystem.reset();
		console.log('Animation system reset');

		return true;
	} catch (error) {
		console.error('Error resetting model pose:', error);
		return false;
	}
}

/**
 * Manually reset all bone transformations
 * @param {Object} model - The 3D model
 */
function resetManually(model) {
	let bonesReset = 0;

	// Preserve the original model position
	const originalPosition = model.position.clone();

	model.traverse((object) => {
		if ('isBone' in object && object.isBone) {
			// Reset rotation only, keep positions intact to maintain model structure
			object.quaternion.identity();
			object.scale.set(1, 1, 1);

			// Update matrix
			object.updateMatrix();
			bonesReset++;
		}
	});

	console.log(`Reset pose by resetting all quaternions (${bonesReset} bones)`);

	// Update world matrices
	model.updateMatrixWorld(true);

	// Ensure the model doesn't sink into the floor
	model.position.copy(originalPosition);

	// Ensure the model stays at a proper height
	if (model.position.y < 100) {
		model.position.y = 120; // Keep model above floor
	}
}
