/* eslint-disable no-unused-vars */
import { getTHREE } from './engine.js';
import { findMatchingBone, getSensorsWithData, boneNamePatterns } from '$lib/motion/sensors.js';
import * as motionStore from '$lib/stores/motionStore.js';
import { correctQuaternion, applyCalibration, isCalibrated } from '$lib/motion/transform.js';

const AnimationSystem = {
	boneMappings: new Map(),

	debugCounter: 0,

	reset() {
		this.boneMappings.clear();
		this.debugCounter = 0;
	}
};

export async function updateModelWithSensorData(context, sensorData, modelType = 'basic') {
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

	AnimationSystem.debugCounter = (AnimationSystem.debugCounter + 1) % 100;

	try {
		if (modelType === 'basic') {
			updatedAny = await updateBasicModel(context, sensorData, THREE);
		} else {
			updatedAny = await updateGLTFModel(context, sensorData, THREE);
		}

		if (updatedAny && context.skeleton) {
			if (typeof context.skeleton.update === 'function') {
				context.skeleton.update();
			} else if (AnimationSystem.debugCounter === 1) {
				console.warn(
					'context.skeleton exists but does not have an update method. Is it a THREE.SkeletonHelper and initialized correctly?',
					context.skeleton
				);
			}
		}

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
				console.log('Model bone mapping issue - check bone names and sensor mapping');

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
		const bodyPart = sensor.bodyPart;
		if (!bodyPart) continue;

		const partName = bodyPart.charAt(0).toLowerCase() + bodyPart.slice(1);
		const part = context.basicModelParts[partName];

		if (part && part.joint && part.limb && sensor.data) {
			if (Array.isArray(sensor.data) && sensor.data.length === 4) {
				if (
					isNaN(sensor.data[0]) ||
					isNaN(sensor.data[1]) ||
					isNaN(sensor.data[2]) ||
					isNaN(sensor.data[3])
				) {
					continue;
				}

				try {
					let transformedData = await correctQuaternion(sensor.data, sensor.bodyPart);

					if (isCalibrated()) {
						transformedData = await applyCalibration(transformedData, sensor.bodyPart);
					}

					const q = new THREE.Quaternion(
						transformedData[1], // x
						transformedData[2], // y
						transformedData[3], // z
						transformedData[0] // w
					);

					q.normalize();

					part.joint.quaternion.copy(q);

					const direction = new THREE.Vector3(0, -1, 0).applyQuaternion(q);

					const midpoint = new THREE.Vector3()
						.copy(part.joint.position)
						.add(direction.clone().multiplyScalar(20));

					part.limb.position.copy(midpoint);

					part.limb.quaternion.setFromUnitVectors(
						new THREE.Vector3(0, 1, 0),
						direction.clone().negate()
					);

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

async function updateGLTFModel(context, sensorData, THREE) {
	const sensors = getSensorsWithData(sensorData);
	const bonesFound = new Set();
	let updatedAny = false;

	if (sensors.length === 0) {
		if (sensorData && sensorData.sequence !== undefined) {
			console.warn(
				`Received sensor data with sequence ${sensorData.sequence} but no sensors were extracted`
			);
			console.log('Raw sensor data keys:', Object.keys(sensorData));
		}
		return false;
	}

	const modelId = context.model.uuid || 'unknown';
	let boneMapping = AnimationSystem.boneMappings.get(modelId);

	if (!boneMapping) {
		boneMapping = buildBoneMapping(context.model);
		AnimationSystem.boneMappings.set(modelId, boneMapping);

		if (Object.keys(boneMapping).length > 0) {
			console.log(
				`Built bone mapping for model ${modelId}: ${Object.keys(boneMapping).length} body parts mapped.`
			);

			Object.entries(boneMapping).forEach(([bodyPart, bones]) => {
				console.log(`  ${bodyPart} -> ${bones.map((b) => b.name).join(', ')}`);
			});
		} else {
			console.warn(
				`Failed to build any bone mappings for model ${modelId}. Check bone names and patterns.`
			);
		}
	}

	let debugEnabled = motionStore.debugEnabled();

	const shouldLogBones =
		debugEnabled &&
		(!context.bonesLogged || (sensorData.sequence && sensorData.sequence % 500 === 0));

	if (shouldLogBones) {
		logModelBoneStructure(context, sensors, boneMapping);
		context.bonesLogged = true;
	}

	for (const sensor of sensors) {
		if (!sensor.bodyPart) {
			if (debugEnabled && AnimationSystem.debugCounter === 0) {
				console.warn(`Sensor ${sensor.index} has no bodyPart mapping`);
			}
			continue;
		}

		const matchingBones = boneMapping[sensor.bodyPart];
		if (!matchingBones || matchingBones.length === 0) {
			if (debugEnabled && AnimationSystem.debugCounter === 0) {
				console.warn(`No bones found for bodyPart: ${sensor.bodyPart}`);
			}
			continue;
		}

		bonesFound.add(sensor.bodyPart);

		if (!Array.isArray(sensor.data) || sensor.data.length !== 4 || sensor.data.some(isNaN)) {
			if (debugEnabled && AnimationSystem.debugCounter === 0) {
				console.warn(`Invalid quaternion data for ${sensor.bodyPart}:`, sensor.data);
			}
			continue;
		}

		try {
			let transformedData = await correctQuaternion(sensor.data, sensor.bodyPart);

			if (isCalibrated()) {
				transformedData = await applyCalibration(transformedData, sensor.bodyPart);
			}

			const q = new THREE.Quaternion(
				transformedData[1], // x
				transformedData[2], // y
				transformedData[3], // z
				transformedData[0] // w
			).normalize();

			for (const boneInfo of matchingBones) {
				if (!boneInfo.bone) continue;

				boneInfo.bone.quaternion.copy(q);

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

function buildBoneMapping(model) {
	const mapping = {};
	const allBones = [];

	model.traverse((object) => {
		if ('isBone' in object && object.isBone) {
			allBones.push(object);
		}
	});

	if (allBones.length === 0) {
		console.warn('No bones found in model. Cannot map sensors to skeleton.');
		return mapping;
	}

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

function logModelBoneStructure(context, sensors, boneMapping) {
	console.log('Analyzing model bone structure:');
	const allBones = [];

	context.model.traverse((obj) => {
		if ('isBone' in obj && obj.isBone) {
			allBones.push(obj.name);
		}
	});

	console.log('Available bones:', allBones);

	console.log('Available sensors:');
	sensors.forEach((sensor) => {
		console.log(`- Sensor ${sensor.index} -> ${sensor.bodyPart || 'unmapped'}`);
	});

	console.log('Attempting to map sensors to bones:');
	sensors.forEach((sensor) => {
		if (!sensor.bodyPart) {
			console.log(`Sensor ${sensor.index}: No body part mapping!`);
			return;
		}

		const patterns = boneNamePatterns[sensor.bodyPart] || [sensor.bodyPart];
		console.log(`Sensor ${sensor.index} (${sensor.bodyPart}): Looking for patterns:`, patterns);

		const matchingBones = boneMapping[sensor.bodyPart] || [];
		const boneNames = matchingBones.map((b) => b.name);

		if (boneNames.length) {
			console.log(`  Found matches:`, boneNames);
		} else {
			console.log(`  NO MATCHING BONES FOUND!`);
		}
	});
}

export function setSkeletonVisibility(context, visible) {
	if (context && context.skeleton) {
		context.skeleton.visible = !!visible;
	}
}

export async function resetModelPose(context) {
	if (!context || !context.model) return false;

	try {
		if (context.mixer) {
			context.mixer.stopAllAction();

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
				resetManually(context.model);
			}
		} else {
			resetManually(context.model);
		}

		AnimationSystem.reset();
		console.log('Animation system reset');

		return true;
	} catch (error) {
		console.error('Error resetting model pose:', error);
		return false;
	}
}

function resetManually(model) {
	let bonesReset = 0;

	const originalPosition = model.position.clone();

	model.traverse((object) => {
		if ('isBone' in object && object.isBone) {
			object.quaternion.identity();
			object.scale.set(1, 1, 1);

			object.updateMatrix();
			bonesReset++;
		}
	});

	console.log(`Reset pose by resetting all quaternions (${bonesReset} bones)`);

	model.updateMatrixWorld(true);

	model.position.copy(originalPosition);

	if (model.position.y < 100) {
		model.position.y = 120;
	}
}
