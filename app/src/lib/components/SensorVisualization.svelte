<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	export let data = {};
	export let connected = false;

	let container;
	let scene, camera, renderer, controls;
	let humanModel = {};
	let frameId;

	// Constants for visualization
	const LIMB_LENGTH = 50;
	const JOINT_RADIUS = 5;
	const COLORS = {
		rightArm: 0x2196f3, // Blue
		leftArm: 0x4caf50, // Green
		rightLeg: 0xf44336, // Red
		leftLeg: 0xff9800, // Orange
		torso: 0x9c27b0, // Purple
		joint: 0xffffff // White
	};

	// Define human model structure
	const bodyStructure = {
		// Right arm
		rightUpperArm: {
			parent: 'torso',
			child: 'rightLowerArm',
			sensorIndex: 7,
			color: COLORS.rightArm
		},
		rightLowerArm: { parent: 'rightUpperArm', child: null, sensorIndex: 6, color: COLORS.rightArm },

		// Left arm
		leftUpperArm: { parent: 'torso', child: 'leftLowerArm', sensorIndex: 5, color: COLORS.leftArm },
		leftLowerArm: { parent: 'leftUpperArm', child: null, sensorIndex: 4, color: COLORS.leftArm },

		// Right leg
		rightUpperLeg: {
			parent: 'torso',
			child: 'rightLowerLeg',
			sensorIndex: 1,
			color: COLORS.rightLeg
		},
		rightLowerLeg: { parent: 'rightUpperLeg', child: null, sensorIndex: 0, color: COLORS.rightLeg },

		// Left leg
		leftUpperLeg: { parent: 'torso', child: 'leftLowerLeg', sensorIndex: 3, color: COLORS.leftLeg },
		leftLowerLeg: { parent: 'leftUpperLeg', child: null, sensorIndex: 2, color: COLORS.leftLeg },

		// Torso - central point, no sensor directly
		torso: { parent: null, child: null, sensorIndex: null, color: COLORS.torso }
	};

	onMount(async () => {
		if (!browser) return; // Only run in browser context

		// Dynamically import Three.js to avoid SSR issues
		const THREE = await import('three');
		const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');

		initScene(THREE, OrbitControls);
		createHumanModel(THREE);
		animate(THREE);

		// Responsive handling
		window.addEventListener('resize', () => onWindowResize(THREE));

		return () => {
			window.removeEventListener('resize', () => onWindowResize(THREE));
			if (frameId) {
				window.cancelAnimationFrame(frameId);
			}
			renderer?.dispose();
			controls?.dispose();
		};
	});

	onDestroy(() => {
		if (browser && frameId) {
			window.cancelAnimationFrame(frameId);
		}
		renderer?.dispose();
		controls?.dispose();
	});

	function initScene(THREE, OrbitControls) {
		// Create scene
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0xf0f0f0);

		// Create camera
		camera = new THREE.PerspectiveCamera(
			75,
			container.clientWidth / container.clientHeight,
			0.1,
			1000
		);
		camera.position.set(0, 100, 200);

		// Create renderer
		renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(container.clientWidth, container.clientHeight);
		renderer.setPixelRatio(window.devicePixelRatio);
		container.appendChild(renderer.domElement);

		// Add controls
		controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.05;

		// Add lights
		const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
		scene.add(ambientLight);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
		directionalLight.position.set(1, 1, 1);
		scene.add(directionalLight);

		// Add a grid
		const gridHelper = new THREE.GridHelper(200, 20, 0x888888, 0x444444);
		scene.add(gridHelper);

		// Add coordinate axes for reference
		const axesHelper = new THREE.AxesHelper(100);
		scene.add(axesHelper);
	}

	function onWindowResize(THREE) {
		if (!container || !camera || !renderer) return;

		camera.aspect = container.clientWidth / container.clientHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(container.clientWidth, container.clientHeight);
	}

	function createHumanModel(THREE) {
		// Create the torso as the central point
		const torsoGeometry = new THREE.SphereGeometry(JOINT_RADIUS * 1.5, 16, 16);
		const torsoMaterial = new THREE.MeshPhongMaterial({ color: COLORS.torso });
		const torsoMesh = new THREE.Mesh(torsoGeometry, torsoMaterial);
		torsoMesh.position.set(0, 100, 0); // Central point of the model
		scene.add(torsoMesh);

		humanModel.torso = {
			joint: torsoMesh,
			direction: new THREE.Vector3(0, 1, 0)
		};

		// Create limbs with joints
		Object.entries(bodyStructure).forEach(([limbName, limbData]) => {
			if (limbName === 'torso') return; // Skip torso, already created

			// Create joint (sphere)
			const jointGeometry = new THREE.SphereGeometry(JOINT_RADIUS, 16, 16);
			const jointMaterial = new THREE.MeshPhongMaterial({ color: COLORS.joint });
			const jointMesh = new THREE.Mesh(jointGeometry, jointMaterial);

			// Position relative to parent
			const parentName = limbData.parent;
			let parentPosition;

			if (parentName === 'torso') {
				parentPosition = humanModel.torso.joint.position.clone();

				// Position limbs around torso
				if (limbName.includes('Arm')) {
					const isRight = limbName.includes('right');
					jointMesh.position.set(
						parentPosition.x + (isRight ? -20 : 20), // Left/right from torso
						parentPosition.y + 10, // Shoulder height
						parentPosition.z
					);
				} else if (limbName.includes('Leg')) {
					const isRight = limbName.includes('right');
					jointMesh.position.set(
						parentPosition.x + (isRight ? -15 : 15), // Left/right from torso
						parentPosition.y - 20, // Below torso
						parentPosition.z
					);
				}
			} else if (humanModel[parentName]) {
				parentPosition = humanModel[parentName].joint.position.clone();

				// Position based on limb type
				if (limbName.includes('Lower')) {
					if (limbName.includes('Arm')) {
						jointMesh.position.set(
							parentPosition.x,
							parentPosition.y - LIMB_LENGTH,
							parentPosition.z
						);
					} else if (limbName.includes('Leg')) {
						jointMesh.position.set(
							parentPosition.x,
							parentPosition.y - LIMB_LENGTH,
							parentPosition.z
						);
					}
				}
			}

			scene.add(jointMesh);

			// Create limb (cylinder)
			if (parentName && humanModel[parentName]) {
				const start = humanModel[parentName].joint.position;
				const end = jointMesh.position;

				// Create a direction vector for the limb
				const direction = new THREE.Vector3().subVectors(end, start).normalize();

				// Calculate height (distance between joints)
				const height = start.distanceTo(end);

				// Create cylinder
				const limbGeometry = new THREE.CylinderGeometry(
					JOINT_RADIUS * 0.7,
					JOINT_RADIUS * 0.7,
					height,
					12
				);
				const limbMaterial = new THREE.MeshPhongMaterial({ color: limbData.color });
				const limbMesh = new THREE.Mesh(limbGeometry, limbMaterial);

				// Position the limb between joints
				const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
				limbMesh.position.copy(midpoint);

				// Rotate to connect the points
				limbMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);

				scene.add(limbMesh);

				// Store in the model
				humanModel[limbName] = {
					joint: jointMesh,
					limb: limbMesh,
					direction: direction,
					sensorIndex: limbData.sensorIndex
				};
			}
		});
	}

	function updateHumanModel(THREE) {
		if (!data || !data.sensorData) return;

		// Update limbs based on quaternion data
		Object.entries(humanModel).forEach(([limbName, limbObj]) => {
			if (limbName === 'torso') return; // Skip torso

			const limbData = bodyStructure[limbName];
			const sensorIdx = limbData.sensorIndex;

			// Check if we have data for this sensor
			if (sensorIdx !== null && data.sensorData[`S${sensorIdx}`]) {
				const quaternion = data.sensorData[`S${sensorIdx}`];

				if (Array.isArray(quaternion) && quaternion.length === 4) {
					// Create THREE.js quaternion
					const q = new THREE.Quaternion(
						quaternion[1], // x
						quaternion[2], // y
						quaternion[3], // z
						quaternion[0] // w
					);

					// Apply quaternion to joint
					limbObj.joint.quaternion.copy(q);

					// Update limb orientation if it exists
					if (limbObj.limb) {
						// Need to recalculate limb orientation based on new joint positions
						const parentName = limbData.parent;
						if (humanModel[parentName]) {
							const start = humanModel[parentName].joint.position;
							const end = limbObj.joint.position;

							// Update direction
							limbObj.direction.subVectors(end, start).normalize();

							// Update limb position and rotation
							const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
							limbObj.limb.position.copy(midpoint);

							// Rotate cylinder to connect the joints
							limbObj.limb.quaternion.setFromUnitVectors(
								new THREE.Vector3(0, 1, 0),
								limbObj.direction
							);

							// Update limb height
							const height = start.distanceTo(end);
							limbObj.limb.scale.set(1, height / LIMB_LENGTH, 1);
						}
					}
				}
			}
		});
	}

	function animate(THREE) {
		frameId = window.requestAnimationFrame(() => animate(THREE));

		if (connected) {
			updateHumanModel(THREE);
		}

		if (controls) controls.update();
		if (renderer) renderer.render(scene, camera);
	}
</script>

<div bind:this={container} class="relative h-full w-full">
	{#if !connected}
		<div class="absolute inset-0 z-10 flex items-center justify-center bg-gray-100 bg-opacity-80">
			<div class="rounded bg-white p-4 text-center shadow-md">
				<h3 class="mb-2 text-lg font-medium text-gray-800">Visualization Inactive</h3>
				<p class="text-gray-600">
					Connect to the system and start streaming to see sensor data visualization.
				</p>
			</div>
		</div>
	{/if}
</div>
