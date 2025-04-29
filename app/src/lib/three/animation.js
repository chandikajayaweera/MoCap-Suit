// Fix for animation.js
import { getTHREE } from './engine.js';
import { findMatchingBone, getSensorsWithData } from '$lib/motion/sensors.js';
import * as motionStore from '$lib/stores/motionStore.js';

// Update the updateModelWithSensorData function
export async function updateModelWithSensorData(context, sensorData, modelType = 'basic') {
	if (!context || !context.model || !sensorData) {
		console.log('Model update missing required data');
		return false;
	}

	const THREE = await getTHREE();
	let updatedAny = false;

	try {
		// Handle both direct and nested sensor data formats
		const actualData = sensorData.sensorData ? sensorData.sensorData : sensorData;

		// Check if we have any sensor data at all
		const hasSensors = Object.keys(actualData).some((key) => key.startsWith('S'));

		if (!hasSensors) {
			console.log('No sensor data found in object');
			return false;
		}

		if (modelType === 'basic') {
			updatedAny = await updateBasicModel(context, actualData, THREE);
		} else {
			updatedAny = await updateGLTFModel(context, actualData, THREE);
		}

		// Update skeleton helper if bones were updated
		if (updatedAny && context.skeleton) {
			context.skeleton.update();
		}
	} catch (err) {
		console.error('Error updating model with sensor data:', err);
		return false;
	}

	return updatedAny;
}

async function updateBasicModel(context, sensorData, THREE) {
	if (!context.basicModelParts) {
		console.log('Basic model parts not initialized');
		return false;
	}

	const sensors = getSensorsWithData(sensorData);
	let updatedAny = false;

	if (sensors.length === 0) {
		console.log('No sensor data available for basic model update');
		return false;
	}

	const partsUpdated = [];

	for (const sensor of sensors) {
		const bodyPart = sensor.bodyPart;
		if (!bodyPart) continue;

		const partName = bodyPart.charAt(0).toLowerCase() + bodyPart.slice(1);
		const part = context.basicModelParts[partName];

		if (part && sensor.data) {
			if (Array.isArray(sensor.data) && sensor.data.length === 4) {
				// Validate quaternion data
				if (sensor.data.some((val) => isNaN(val))) continue;

				// Extract quaternion components - Motion capture data typically uses [w,x,y,z] format
				const [w, x, y, z] = sensor.data;

				// Create quaternion directly - no extra transformations here
				const q = new THREE.Quaternion(x, y, z, w);

				// Apply directly to joint without additional transformations
				part.joint.quaternion.copy(q);

				// Update limb orientation
				const direction = new THREE.Vector3(0, -1, 0).applyQuaternion(q);

				// Position limb to connect from joint
				const midpoint = new THREE.Vector3()
					.copy(part.joint.position)
					.add(direction.clone().multiplyScalar(20));

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

	return updatedAny;
}

async function updateGLTFModel(context, sensorData, THREE) {
	const sensors = getSensorsWithData(sensorData);
	const bonesFound = new Set();
	let updatedAny = false;

	// Enhanced debugging
	console.log('----- Bone Matching Debug -----');
	console.log(
		`Processing ${sensors.length} sensors with data, sequence: ${sensorData.sequence || 'unknown'}`
	);

	if (sensors.length === 0) {
		console.log('No sensor data available for model update');
		return false;
	}

	// Model-specific coordinate system adjustments
	const MODEL_ADJUSTMENTS = {
		xbot: {
			axis: new THREE.Vector3(0, 1, 0),
			angle: -Math.PI / 2, // X Bot typically needs -90° Y rotation
			applyOrder: 'premultiply'
		},
		amy: {
			axis: new THREE.Vector3(0, 1, 0),
			angle: -Math.PI / 2,
			applyOrder: 'premultiply'
		},
		basic: null
	};

	// Detect model type
	let modelType = context.modelType || 'xbot';
	if (modelType !== 'xbot' && modelType !== 'amy' && modelType !== 'basic') {
		modelType = 'xbot'; // Default to xbot for unknown models
	}

	const adjustment = MODEL_ADJUSTMENTS[modelType];

	// Log each sensor for debugging
	sensors.forEach((sensor) => {
		if (sensor.bodyPart) {
			console.log(`Sensor ${sensor.index} (${sensor.bodyPart}): [${sensor.data.join(', ')}]`);
		}
	});

	// Log all bones in the model on first run
	if (!context.bonesLogged) {
		const allBones = [];
		context.model.traverse((obj) => {
			if (obj.isBone || obj.type === 'Bone') {
				allBones.push(obj.name);
			}
		});
		console.log('Available bones in model:', allBones);
		context.bonesLogged = true;
	}

	// VERIFICATION: Log exact bone matches before applying
	sensors.forEach((sensor) => {
		if (!sensor.bodyPart) return;

		context.model.traverse((obj) => {
			if ((obj.isBone || obj.type === 'Bone') && findMatchingBone(obj, sensor.bodyPart)) {
				console.log(`Matched ${sensor.bodyPart} to bone:`, obj.name);
				console.log('Sensor data:', sensor.data);
				console.log('Bone initial rotation:', obj.rotation);
			}
		});
	});

	// Update bones with sensor data
	context.model.traverse((object) => {
		if (object.isBone || object.type === 'Bone') {
			for (const sensor of sensors) {
				if (sensor.bodyPart && findMatchingBone(object, sensor.bodyPart)) {
					bonesFound.add(sensor.bodyPart);

					if (Array.isArray(sensor.data) && sensor.data.length === 4) {
						// Make sure quaternion is valid
						if (sensor.data.some((val) => isNaN(val))) continue;

						// Get quaternion components
						const [w, x, y, z] = sensor.data;

						// Create quaternion - BNO055 uses [w,x,y,z] format, THREE.js expects [x,y,z,w]
						const sensorQuat = new THREE.Quaternion(x, y, z, w);

						// Apply coordinate system adjustment if needed
						if (adjustment) {
							const adjustQuat = new THREE.Quaternion().setFromAxisAngle(
								adjustment.axis,
								adjustment.angle
							);

							if (adjustment.applyOrder === 'premultiply') {
								sensorQuat.premultiply(adjustQuat);
							} else {
								sensorQuat.multiply(adjustQuat);
							}
						}

						// Apply quaternion to bone
						object.quaternion.copy(sensorQuat);

						// Reset position to prevent drift
						object.position.set(0, 0, 0);

						// Normalize quaternion to prevent drift
						object.quaternion.normalize();

						// Ensure matrices are updated
						object.updateMatrix();
						object.updateMatrixWorld(true);

						// Add visual debug helper if in debug mode
						if (motionStore.debugMode) {
							const helper = new THREE.AxesHelper(20);
							object.add(helper);
							setTimeout(() => {
								if (object && helper) object.remove(helper);
							}, 1000);
						}

						updatedAny = true;
					}
				}
			}
		}
	});

	// Log results
	if (sensors.length > 0) {
		console.log(`Found and updated ${bonesFound.size}/${sensors.length} bones`);

		// List missing bones
		const missingSensors = sensors
			.filter((s) => s.bodyPart && !bonesFound.has(s.bodyPart))
			.map((s) => s.bodyPart);

		if (missingSensors.length > 0) {
			console.warn('Missing bones for these body parts:', missingSensors);
		}
	}

	// DIAGNOSTIC: If no bones were found, try a more aggressive approach
	if (sensors.length > 0 && bonesFound.size === 0) {
		console.warn('NO BONE MATCHES FOUND! Trying a last-resort approach');

		// Try direct naming patterns
		const directMappings = {
			RightUpperArm: 'Armature_UpperArm_R',
			RightLowerArm: 'Armature_LowerArm_R',
			LeftUpperArm: 'Armature_UpperArm_L',
			LeftLowerArm: 'Armature_LowerArm_L',
			RightUpperLeg: 'Armature_UpperLeg_R',
			RightLowerLeg: 'Armature_LowerLeg_R',
			LeftUpperLeg: 'Armature_UpperLeg_L',
			LeftLowerLeg: 'Armature_LowerLeg_L'
		};

		sensors.forEach((sensor) => {
			if (!sensor.bodyPart) return;

			const directBoneName = directMappings[sensor.bodyPart];
			if (directBoneName) {
				const bone = context.model.getObjectByName(directBoneName);
				if (bone) {
					console.log(`DIRECT MATCH: ${sensor.bodyPart} -> ${directBoneName}`);

					const [w, x, y, z] = sensor.data;
					bone.quaternion.set(x, y, z, w);
					bone.quaternion.normalize();
					bone.updateMatrix();
					bone.updateMatrixWorld(true);

					updatedAny = true;
				}
			}
		});
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

	// For both GLTF and basic models
	context.model.traverse((obj) => {
		if (obj.isBone || obj.type === 'Bone') {
			// Reset all transform components
			obj.quaternion.set(0, 0, 0, 1);
			obj.rotation.set(0, 0, 0);
			obj.position.set(0, 0, 0);
			obj.scale.set(1, 1, 1);
			obj.updateMatrixWorld(true);
		}
	});

	if (context.mixer) {
		context.mixer.stopAllAction();
		context.mixer.uncacheRoot(context.model);

		// Force T-pose through animation system if available
		const clip = context.model.animations?.find(
			(a) =>
				a.name.toLowerCase().includes('t-pose') ||
				a.name.toLowerCase().includes('bind') ||
				a.name.toLowerCase().includes('idle')
		);

		if (clip) {
			context.mixer.clipAction(clip).reset().setEffectiveTimeScale(1).play();
		}
	}
}

// Add this to expose model information globally for debugging
export function exposeModelInfo(context) {
	if (!context || !context.model) return null;

	const modelInfo = {
		bones: [],
		animations: [],
		hierarchy: {}
	};

	// Get all bones
	context.model.traverse((obj) => {
		if (obj.isBone || obj.type === 'Bone') {
			modelInfo.bones.push({
				name: obj.name,
				position: obj.position.toArray(),
				rotation: obj.rotation.toArray(),
				parent: obj.parent ? obj.parent.name : 'none'
			});

			// Build hierarchy
			const parentName = obj.parent ? obj.parent.name : 'root';
			if (!modelInfo.hierarchy[parentName]) {
				modelInfo.hierarchy[parentName] = [];
			}
			modelInfo.hierarchy[parentName].push(obj.name);
		}
	});

	// Get animations
	if (context.model.animations) {
		modelInfo.animations = context.model.animations.map((a) => ({
			name: a.name,
			duration: a.duration
		}));
	}

	// Make available globally
	// @ts-ignore
	window.__modelInfo = modelInfo;
	console.log('Model info exposed at window.__modelInfo');

	return modelInfo;
}
