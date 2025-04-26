// Environment management for Three.js scenes
import { getTHREE } from './engine.js';

// Apply an environment configuration to the scene
export async function applyEnvironment(context, environmentId) {
	if (!context || !context.scene) return;

	const THREE = await getTHREE();

	// Clear existing environment elements
	context.scene.background = null;
	context.scene.fog = null;

	// Remove existing lights and environment objects
	context.scene.children = context.scene.children.filter((child) => {
		if (child.isLight || child.isGridHelper || (child.userData && child.userData.isEnvironment)) {
			if (child.geometry) child.geometry.dispose();
			if (child.material) {
				if (Array.isArray(child.material)) {
					child.material.forEach((material) => material.dispose());
				} else {
					child.material.dispose();
				}
			}
			return false;
		}
		return true;
	});

	// Add environment-specific elements
	switch (environmentId) {
		case 'studio':
			applyStudioEnvironment(context, THREE);
			break;

		case 'outdoor':
			applyOutdoorEnvironment(context, THREE);
			break;

		case 'dark':
			applyDarkEnvironment(context, THREE);
			break;

		case 'grid':
			applyGridEnvironment(context, THREE);
			break;

		default:
			// Default to studio environment
			applyStudioEnvironment(context, THREE);
	}
}

// Studio environment - neutral, well-lit
function applyStudioEnvironment(context, THREE) {
	context.scene.background = new THREE.Color(0xf0f0f0);
	context.scene.fog = new THREE.Fog(0xf0f0f0, 10, 500);

	// Ambient light
	const ambientLight = new THREE.AmbientLight(0x404040, 2);
	context.scene.add(ambientLight);

	// Directional light (sun-like)
	const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
	directionalLight.position.set(1, 1, 1);
	directionalLight.castShadow = true;
	directionalLight.shadow.mapSize.width = 2048;
	directionalLight.shadow.mapSize.height = 2048;
	directionalLight.shadow.camera.near = 0.5;
	directionalLight.shadow.camera.far = 500;
	directionalLight.shadow.camera.left = -100;
	directionalLight.shadow.camera.right = 100;
	directionalLight.shadow.camera.top = 100;
	directionalLight.shadow.camera.bottom = -100;
	context.scene.add(directionalLight);

	// Floor
	const floorGeometry = new THREE.PlaneGeometry(2000, 2000);
	const floorMaterial = new THREE.MeshPhongMaterial({
		color: 0xeeeeee,
		depthWrite: true,
		shininess: 0
	});
	const floor = new THREE.Mesh(floorGeometry, floorMaterial);
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = true;
	floor.userData.isEnvironment = true;
	context.scene.add(floor);

	// Grid
	const grid = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
	grid.material.opacity = 0.2;
	grid.material.transparent = true;
	context.scene.add(grid);
}

// Outdoor environment - blue sky, natural lighting
function applyOutdoorEnvironment(context, THREE) {
	context.scene.background = new THREE.Color(0x87ceeb);
	context.scene.fog = new THREE.Fog(0x87ceeb, 10, 1000);

	// Hemisphere light (sky/ground)
	const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
	hemiLight.position.set(0, 200, 0);
	context.scene.add(hemiLight);

	// Directional light (sun)
	const dirLight = new THREE.DirectionalLight(0xffd700, 2);
	dirLight.position.set(-50, 100, 50);
	dirLight.castShadow = true;
	dirLight.shadow.mapSize.width = 2048;
	dirLight.shadow.mapSize.height = 2048;
	dirLight.shadow.camera.near = 0.5;
	dirLight.shadow.camera.far = 500;
	dirLight.shadow.camera.left = -200;
	dirLight.shadow.camera.right = 200;
	dirLight.shadow.camera.top = 200;
	dirLight.shadow.camera.bottom = -200;
	context.scene.add(dirLight);

	// Ground
	const groundGeometry = new THREE.PlaneGeometry(2000, 2000);
	const groundMaterial = new THREE.MeshPhongMaterial({
		color: 0x7cfc00,
		depthWrite: true,
		shininess: 0
	});
	const ground = new THREE.Mesh(groundGeometry, groundMaterial);
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	ground.userData.isEnvironment = true;
	context.scene.add(ground);
}

// Dark room environment - dramatic lighting
function applyDarkEnvironment(context, THREE) {
	context.scene.background = new THREE.Color(0x000000);
	context.scene.fog = new THREE.Fog(0x000000, 10, 200);

	// Ambient light (minimal)
	const ambLight = new THREE.AmbientLight(0x101010, 1);
	context.scene.add(ambLight);

	// Spotlights for dramatic effect
	const spotLight1 = new THREE.SpotLight(0x0000ff, 5);
	spotLight1.position.set(100, 200, 100);
	spotLight1.angle = Math.PI / 8;
	spotLight1.penumbra = 0.2;
	spotLight1.castShadow = true;
	context.scene.add(spotLight1);

	const spotLight2 = new THREE.SpotLight(0xff0000, 5);
	spotLight2.position.set(-100, 200, 100);
	spotLight2.angle = Math.PI / 8;
	spotLight2.penumbra = 0.2;
	spotLight2.castShadow = true;
	context.scene.add(spotLight2);

	// Dark floor
	const darkFloorGeometry = new THREE.PlaneGeometry(2000, 2000);
	const darkFloorMaterial = new THREE.MeshPhongMaterial({
		color: 0x111111,
		depthWrite: true,
		shininess: 100
	});
	const darkFloor = new THREE.Mesh(darkFloorGeometry, darkFloorMaterial);
	darkFloor.rotation.x = -Math.PI / 2;
	darkFloor.receiveShadow = true;
	darkFloor.userData.isEnvironment = true;
	context.scene.add(darkFloor);
}

// Grid only - minimal environment
function applyGridEnvironment(context, THREE) {
	context.scene.background = new THREE.Color(0x000000);

	// Basic lighting
	const basicLight = new THREE.AmbientLight(0xffffff, 2);
	context.scene.add(basicLight);

	// Grid
	const gridOnly = new THREE.GridHelper(200, 40, 0xffffff, 0x444444);
	context.scene.add(gridOnly);
}
