// 3D models management
import { getTHREE, getGLTFLoader } from './engine.js';
import * as motionStore from '$lib/stores/motionStore.js';

class ModelManager {
	constructor() {
		this.models = [
			{ id: 'basic', name: 'Basic Model', url: null },
			{ id: 'xbot', name: 'X Bot', url: '/models/mannequin.glb' },
			{ id: 'amy', name: 'Amy (Girl)', url: '/models/amy.glb' }
		];

		this.environments = [
			{ id: 'studio', name: 'Studio' },
			{ id: 'outdoor', name: 'Outdoor' },
			{ id: 'dark', name: 'Dark Room' },
			{ id: 'grid', name: 'Grid Only' },
			{ id: 'shadowless', name: 'Shadowless Studio' }
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

const modelManager = new ModelManager();
export default modelManager;

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

async function createLimb(context, name, posX, posY, posZ, color, parent) {
	const THREE = await getTHREE();

	const jointGeometry = new THREE.SphereGeometry(JOINT_RADIUS, 16, 16);
	const jointMaterial = new THREE.MeshPhongMaterial({ color: COLORS.joint });
	const joint = new THREE.Mesh(jointGeometry, jointMaterial);
	joint.position.set(posX, posY, posZ);
	joint.castShadow = true;
	joint.name = name;
	parent.add(joint);

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

export async function createBasicModel(context) {
	if (!context || !context.scene) return;

	motionStore.setLoading(true);
	const THREE = await getTHREE();

	if (context.model) {
		context.scene.remove(context.model);
		context.model = null;
	}

	if (context.skeleton) {
		context.scene.remove(context.skeleton);
		context.skeleton = null;
	}

	const group = new THREE.Group();

	group.position.set(0, 120, 0);

	const torsoGeometry = new THREE.CylinderGeometry(15, 10, 40, 16);
	const torsoMaterial = new THREE.MeshPhongMaterial({ color: COLORS.torso });
	const torso = new THREE.Mesh(torsoGeometry, torsoMaterial);
	torso.position.set(0, 0, 0);
	torso.castShadow = true;
	group.add(torso);

	const headGeometry = new THREE.SphereGeometry(10, 16, 16);
	const headMaterial = new THREE.MeshPhongMaterial({ color: COLORS.torso });
	const head = new THREE.Mesh(headGeometry, headMaterial);
	head.position.set(0, 30, 0);
	head.castShadow = true;
	group.add(head);

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

	context.scene.add(group);
	context.model = group;

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

export async function loadModel(context, modelId) {
	if (!context || !context.scene) return;

	const modelData = modelManager.getModelById(modelId);

	if (!modelData || !modelData.url) {
		console.log('Model not found or missing URL, creating basic model:', modelId);
		return createBasicModel(context);
	}

	motionStore.setLoading(true);
	console.log(`Loading model: ${modelId} from ${modelData.url}`);

	try {
		const THREE = await getTHREE();
		const GLTFLoader = await getGLTFLoader();

		if (context.model) {
			context.scene.remove(context.model);
			context.model = null;
		}

		if (context.skeleton) {
			context.scene.remove(context.skeleton);
			context.skeleton = null;
		}

		const loader = new GLTFLoader();

		return new Promise((resolve, reject) => {
			loader.load(
				modelData.url,
				(gltf) => {
					context.model = gltf.scene;
					console.log(`Model loaded successfully: ${modelId}`);

					if (motionStore.debugMode) {
						console.log('Model bone structure:');
						context.model.traverse((object) => {
							if (object.isBone || object.type === 'Bone') {
								console.log(`Bone: ${object.name}`);
							}
						});
					}

					context.model.traverse((object) => {
						if (object.isMesh) {
							object.castShadow = true;
							object.receiveShadow = true;
						}
					});

					context.scene.add(context.model);

					context.skeleton = new THREE.SkeletonHelper(context.model);
					context.skeleton.visible = motionStore.showSkeleton;
					context.scene.add(context.skeleton);

					if (gltf.animations && gltf.animations.length > 0) {
						context.mixer = new THREE.AnimationMixer(context.model);

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
					const percent = (xhr.loaded / xhr.total) * 100;
					console.log(`Loading model: ${Math.round(percent)}%`);
				},
				(error) => {
					console.error('Error loading model:', error);
					motionStore.setLoading(false);

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
