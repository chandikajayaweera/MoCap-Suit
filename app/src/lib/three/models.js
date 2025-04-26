// 3D models management
import { getTHREE, getGLTFLoader } from './engine.js';
import * as motionStore from '$lib/stores/motionStore.js';

// Model configuration
export class ModelManager {
	constructor() {
		this.models = [
			{ id: 'basic', name: 'Basic Model', url: null },
			{ id: 'xbot', name: 'X Bot', url: '/models/Xbot.glb' },
			{ id: 'amy', name: 'Amy (Girl)', url: '/models/amy.glb' }
		];

		this.environments = [
			{ id: 'studio', name: 'Studio' },
			{ id: 'outdoor', name: 'Outdoor' },
			{ id: 'dark', name: 'Dark Room' },
			{ id: 'grid', name: 'Grid Only' }
		];
	}

	getModels() {
		return this.models;
	}

	getEnvironments() {
		return this.environments;
	}

	getModelById(id) {
		return this.models.find((model) => model.id === id);
	}
}

// Singleton instance
export default new ModelManager();

// Constants for basic model
const LIMB_LENGTH = 40;
const JOINT_RADIUS = 5;
const LIMB_RADIUS = 3;
const COLORS = {
	rightArm: 0x2196f3, // Blue
	leftArm: 0x4caf50, // Green
	rightLeg: 0xf44336, // Red
	leftLeg: 0xff9800, // Orange
	torso: 0x9c27b0, // Purple
	joint: 0xffffff // White
};

// Create a limb for the basic model
async function createLimb(context, name, posX, posY, posZ, color, parent) {
	const THREE = await getTHREE();

	// Create joint (connection point)
	const jointGeometry = new THREE.SphereGeometry(JOINT_RADIUS, 16, 16);
	const jointMaterial = new THREE.MeshPhongMaterial({ color: COLORS.joint });
	const joint = new THREE.Mesh(jointGeometry, jointMaterial);
	joint.position.set(posX, posY, posZ);
	joint.castShadow = true;
	joint.name = name;
	parent.add(joint);

	// Create limb (cylinder)
	const limbGeometry = new THREE.CylinderGeometry(LIMB_RADIUS, LIMB_RADIUS, LIMB_LENGTH, 12);
	const limbMaterial = new THREE.MeshPhongMaterial({ color: color });
	const limb = new THREE.Mesh(limbGeometry, limbMaterial);
	limb.position.set(posX, posY - LIMB_LENGTH / 2, posZ);
	limb.castShadow = true;
	parent.add(limb);

	return {
		joint: joint,
		limb: limb
	};
}

// Create a basic humanoid model
export async function createBasicModel(context) {
	if (!context || !context.scene) return;

	motionStore.setLoading(true);
	const THREE = await getTHREE();

	// Clear previous model
	if (context.model) {
		context.scene.remove(context.model);
		context.model = null;
	}

	// Clear previous skeleton helper
	if (context.skeleton) {
		context.scene.remove(context.skeleton);
		context.skeleton = null;
	}

	// Create a group to hold all model parts
	const group = new THREE.Group();
	group.position.set(0, 100, 0);

	// Create torso
	const torsoGeometry = new THREE.CylinderGeometry(15, 10, 40, 16);
	const torsoMaterial = new THREE.MeshPhongMaterial({ color: COLORS.torso });
	const torso = new THREE.Mesh(torsoGeometry, torsoMaterial);
	torso.position.set(0, 0, 0);
	torso.castShadow = true;
	group.add(torso);

	// Create head
	const headGeometry = new THREE.SphereGeometry(10, 16, 16);
	const headMaterial = new THREE.MeshPhongMaterial({ color: COLORS.torso });
	const head = new THREE.Mesh(headGeometry, headMaterial);
	head.position.set(0, 30, 0);
	head.castShadow = true;
	group.add(head);

	// Create limbs with correctly mapped parts
	context.basicModelParts = {
		rightUpperArm: await createLimb(context, 'rightUpperArm', -25, 15, 0, COLORS.rightArm, group),
		rightLowerArm: await createLimb(context, 'rightLowerArm', -25, -25, 0, COLORS.rightArm, group),
		leftUpperArm: await createLimb(context, 'leftUpperArm', 25, 15, 0, COLORS.leftArm, group),
		leftLowerArm: await createLimb(context, 'leftLowerArm', 25, -25, 0, COLORS.leftArm, group),
		rightUpperLeg: await createLimb(context, 'rightUpperLeg', -15, -20, 0, COLORS.rightLeg, group),
		rightLowerLeg: await createLimb(context, 'rightLowerLeg', -15, -60, 0, COLORS.rightLeg, group),
		leftUpperLeg: await createLimb(context, 'leftUpperLeg', 15, -20, 0, COLORS.leftLeg, group),
		leftLowerLeg: await createLimb(context, 'leftLowerLeg', 15, -60, 0, COLORS.leftLeg, group)
	};

	// Add group to scene
	context.scene.add(group);
	context.model = group;

	// Create basic skeleton helper for visualization
	const points = [];
	points.push(new THREE.Vector3(0, 0, 0)); // Torso
	Object.values(context.basicModelParts).forEach((part) => {
		points.push(part.joint.position);
	});

	const geometry = new THREE.BufferGeometry().setFromPoints(points);
	const material = new THREE.LineBasicMaterial({
		color: 0xffffff,
		visible: motionStore.showSkeleton
	});
	context.skeleton = new THREE.Line(geometry, material);
	context.scene.add(context.skeleton);

	motionStore.setLoading(false);
	return group;
}

// Load a GLTF model
export async function loadModel(context, modelId) {
	if (!context || !context.scene) return;

	const modelManager = new ModelManager();
	const modelData = modelManager.getModelById(modelId);

	if (!modelData || !modelData.url) {
		console.error('Model not found or missing URL:', modelId);
		return createBasicModel(context);
	}

	motionStore.setLoading(true);

	try {
		const THREE = await getTHREE();
		const GLTFLoader = await getGLTFLoader();

		// Clear previous model
		if (context.model) {
			context.scene.remove(context.model);
			context.model = null;
		}

		// Clear previous skeleton helper
		if (context.skeleton) {
			context.scene.remove(context.skeleton);
			context.skeleton = null;
		}

		// Load the model
		const loader = new GLTFLoader();

		return new Promise((resolve, reject) => {
			loader.load(
				modelData.url,
				(gltf) => {
					// Store model
					context.model = gltf.scene;

					// Log bone structure if debug is enabled
					if (motionStore.debugMode) {
						console.log('Model bone structure:');
						context.model.traverse((object) => {
							if (object.isBone || object.type === 'Bone') {
								console.log(`Bone: ${object.name}`);
							}
						});
					}

					// Configure model
					context.model.traverse((object) => {
						if (object.isMesh) {
							object.castShadow = true;
							object.receiveShadow = true;
						}
					});

					// Add model to scene
					context.scene.add(context.model);

					// Create skeleton helper
					context.skeleton = new THREE.SkeletonHelper(context.model);
					context.skeleton.visible = motionStore.showSkeleton;
					context.scene.add(context.skeleton);

					// Set up animation mixer
					if (gltf.animations && gltf.animations.length > 0) {
						context.mixer = new THREE.AnimationMixer(context.model);

						// Put model in T-pose by default
						const action = context.mixer.clipAction(
							gltf.animations.find(
								(a) =>
									a.name.toLowerCase().includes('t-pose') || a.name.toLowerCase().includes('idle')
							) || gltf.animations[0]
						);
						action.play();
					}

					motionStore.setLoading(false);
					resolve(context.model);
				},
				(xhr) => {
					// Progress callback
					const percent = (xhr.loaded / xhr.total) * 100;
					motionStore.logDebug(`Loading model: ${Math.round(percent)}%`);
				},
				(error) => {
					console.error('Error loading model:', error);
					motionStore.setLoading(false);

					// Fallback to basic model
					createBasicModel(context).then(resolve).catch(reject);
				}
			);
		});
	} catch (error) {
		console.error('Error loading model:', error);
		motionStore.setLoading(false);
		return createBasicModel(context);
	}
}
