import { getTHREE } from './engine.js';

export async function applyEnvironment(context, environmentId) {
	if (!context || !context.scene) return;

	const THREE = await getTHREE();

	context.scene.background = null;
	context.scene.fog = null;

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

		case 'shadowless':
			applyShadowlessEnvironment(context, THREE);
			break;

		default:
			applyStudioEnvironment(context, THREE);
	}
}

function applyStudioEnvironment(context, THREE) {
	context.scene.background = new THREE.Color(0xffffff);

	context.scene.fog = null;

	const ambientLight = new THREE.AmbientLight(0xffffff, 2);
	context.scene.add(ambientLight);

	const lightPositions = [
		{ pos: [150, 100, 150], color: 0xffffff, intensity: 0.6 },
		{ pos: [-150, 100, 150], color: 0xffffff, intensity: 0.6 },
		{ pos: [150, 100, -150], color: 0xffffff, intensity: 0.6 },
		{ pos: [-150, 100, -150], color: 0xffffff, intensity: 0.6 },
		{ pos: [0, 200, 0], color: 0xffffff, intensity: 0.8 }
	];

	lightPositions.forEach((light) => {
		const directionalLight = new THREE.DirectionalLight(light.color, light.intensity);
		directionalLight.position.set(...light.pos);
		directionalLight.castShadow = false;
		context.scene.add(directionalLight);
	});

	const floorGeometry = new THREE.PlaneGeometry(2000, 2000);
	const floorMaterial = new THREE.MeshStandardMaterial({
		color: 0xf8f8f8,
		metalness: 0.1,
		roughness: 0.7
	});

	const floor = new THREE.Mesh(floorGeometry, floorMaterial);
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = false;
	floor.userData.isEnvironment = true;
	context.scene.add(floor);

	const grid = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
	grid.material.opacity = 0.1;
	grid.material.transparent = true;
	grid.position.y = 0.1;
	context.scene.add(grid);
}

function applyOutdoorEnvironment(context, THREE) {
	const topColor = new THREE.Color(0x88c6eb);
	const bottomColor = new THREE.Color(0xe4f0f9);

	const canvas = document.createElement('canvas');
	canvas.width = 2;
	canvas.height = 512;
	const ctx = canvas.getContext('2d');
	const gradient = ctx.createLinearGradient(0, 0, 0, 512);
	gradient.addColorStop(0, topColor.getStyle());
	gradient.addColorStop(1, bottomColor.getStyle());
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 2, 512);

	const texture = new THREE.CanvasTexture(canvas);
	context.scene.background = texture;

	context.scene.fog = new THREE.FogExp2(0xe4f0f9, 0.0015);

	const sunLight = new THREE.DirectionalLight(0xfffaed, 2);
	sunLight.position.set(-50, 100, 50);
	sunLight.castShadow = true;
	sunLight.shadow.mapSize.width = 2048;
	sunLight.shadow.mapSize.height = 2048;
	sunLight.shadow.camera.near = 0.5;
	sunLight.shadow.camera.far = 500;
	sunLight.shadow.camera.left = -200;
	sunLight.shadow.camera.right = 200;
	sunLight.shadow.camera.top = 200;
	sunLight.shadow.camera.bottom = -200;
	sunLight.shadow.bias = -0.0001;
	context.scene.add(sunLight);

	const hemiLight = new THREE.HemisphereLight(0x88c6eb, 0x55bb33, 1.2);
	hemiLight.position.set(0, 200, 0);
	context.scene.add(hemiLight);

	const groundGeometry = new THREE.PlaneGeometry(2000, 2000, 128, 128);
	const groundMaterial = new THREE.MeshStandardMaterial({
		color: 0x7ec850,
		metalness: 0.1,
		roughness: 0.9,
		flatShading: false
	});

	const vertices = groundGeometry.attributes.position.array;
	for (let i = 0; i < vertices.length; i += 3) {
		if (i % 9 !== 0) continue;
		vertices[i + 2] = Math.random() * 2; // Z displacement
	}
	groundGeometry.attributes.position.needsUpdate = true;
	groundGeometry.computeVertexNormals();

	const ground = new THREE.Mesh(groundGeometry, groundMaterial);
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	ground.userData.isEnvironment = true;
	context.scene.add(ground);
}

function applyDarkEnvironment(context, THREE) {
	context.scene.background = new THREE.Color(0x111111);
	context.scene.fog = new THREE.FogExp2(0x000000, 0.0025);

	const ambLight = new THREE.AmbientLight(0x111111, 0.5);
	context.scene.add(ambLight);

	const spotLight1 = new THREE.SpotLight(0x0066ff, 8, 400, Math.PI / 6, 0.5, 1);
	spotLight1.position.set(100, 250, 100);
	spotLight1.castShadow = true;
	spotLight1.shadow.mapSize.width = 2048;
	spotLight1.shadow.mapSize.height = 2048;
	spotLight1.shadow.bias = -0.0001;
	context.scene.add(spotLight1);

	const target1 = new THREE.Object3D();
	target1.position.set(0, 100, 0);
	context.scene.add(target1);
	spotLight1.target = target1;

	const spotLight2 = new THREE.SpotLight(0xff3333, 5, 300, Math.PI / 6, 0.5, 1);
	spotLight2.position.set(-150, 150, -50);
	spotLight2.castShadow = true;
	spotLight2.shadow.mapSize.width = 1024;
	spotLight2.shadow.mapSize.height = 1024;
	spotLight2.shadow.bias = -0.0001;
	context.scene.add(spotLight2);

	const target2 = new THREE.Object3D();
	target2.position.set(0, 50, 0);
	context.scene.add(target2);
	spotLight2.target = target2;

	const spotLight3 = new THREE.SpotLight(0x9933ff, 4, 200, Math.PI / 6, 0.5, 1);
	spotLight3.position.set(0, 100, -150);
	context.scene.add(spotLight3);

	const target3 = new THREE.Object3D();
	target3.position.set(0, 100, 0);
	context.scene.add(target3);
	spotLight3.target = target3;

	const darkFloorGeometry = new THREE.PlaneGeometry(2000, 2000);
	const darkFloorMaterial = new THREE.MeshStandardMaterial({
		color: 0x0a0a0a,
		metalness: 0.8,
		roughness: 0.2,
		envMapIntensity: 1.5
	});

	const darkFloor = new THREE.Mesh(darkFloorGeometry, darkFloorMaterial);
	darkFloor.rotation.x = -Math.PI / 2;
	darkFloor.receiveShadow = true;
	darkFloor.userData.isEnvironment = true;
	context.scene.add(darkFloor);
}

function applyGridEnvironment(context, THREE) {
	context.scene.background = new THREE.Color(0xf0f0f0);

	const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
	context.scene.add(ambientLight);

	const lightPositions = [
		{ pos: [1, 1, 1], intensity: 0.1 },
		{ pos: [-1, 1, 1], intensity: 0.5 },
		{ pos: [1, 1, -1], intensity: 0.5 },
		{ pos: [-1, 1, -1], intensity: 0.5 },
		{ pos: [0, 1, 0], intensity: 0.7 }
	];

	lightPositions.forEach((config) => {
		const light = new THREE.DirectionalLight(0xffffff, config.intensity);
		light.position
			.set(...config.pos)
			.normalize()
			.multiplyScalar(200);
		light.castShadow = false;
		context.scene.add(light);
	});

	const primaryGrid = new THREE.GridHelper(200, 20, 0x444444, 0x2196f3);
	primaryGrid.material.transparent = true;
	primaryGrid.material.opacity = 0.9;
	context.scene.add(primaryGrid);

	const secondaryGrid = new THREE.GridHelper(2000, 20, 0x222222, 0x333333);
	secondaryGrid.material.transparent = true;
	secondaryGrid.material.opacity = 0.5;
	context.scene.add(secondaryGrid);

	const xyGrid = new THREE.GridHelper(200, 20, 0x444444, 0x4caf50);
	xyGrid.material.transparent = true;
	xyGrid.material.opacity = 0.7;
	xyGrid.rotation.x = Math.PI / 2;
	xyGrid.position.z = -100;
	context.scene.add(xyGrid);

	const yzGrid = new THREE.GridHelper(200, 20, 0x444444, 0xf44336);
	yzGrid.material.transparent = true;
	yzGrid.material.opacity = 0.7;
	yzGrid.rotation.z = Math.PI / 2;
	yzGrid.position.x = -100;
	context.scene.add(yzGrid);

	const axesHelper = new THREE.AxesHelper(100);
	axesHelper.setColors(
		new THREE.Color(0xff0000), // X axis: red
		new THREE.Color(0x00ff00), // Y axis: green
		new THREE.Color(0x0000ff) // Z axis: blue
	);
	context.scene.add(axesHelper);
}

function applyShadowlessEnvironment(context, THREE) {
	context.scene.background = new THREE.Color(0xffffff);

	context.scene.fog = null;

	const ambientLight = new THREE.AmbientLight(0xffffff, 2);
	context.scene.add(ambientLight);

	const lightPositions = [
		{ pos: [150, 100, 150], color: 0xffffff, intensity: 0.7 },
		{ pos: [-150, 100, 150], color: 0xffffff, intensity: 0.7 },
		{ pos: [150, 100, -150], color: 0xffffff, intensity: 0.7 },
		{ pos: [-150, 100, -150], color: 0xffffff, intensity: 0.7 },
		{ pos: [0, 200, 0], color: 0xffffff, intensity: 0.7 },
		{ pos: [0, -50, 200], color: 0xffffff, intensity: 0.5 }
	];

	lightPositions.forEach((light) => {
		const directionalLight = new THREE.DirectionalLight(light.color, light.intensity);
		directionalLight.position.set(...light.pos);
		directionalLight.castShadow = false;
		context.scene.add(directionalLight);
	});

	const floorGeometry = new THREE.PlaneGeometry(2000, 2000);
	const floorMaterial = new THREE.MeshStandardMaterial({
		color: 0xffffff,
		metalness: 0.1,
		roughness: 0.7,
		flatShading: false
	});

	const floor = new THREE.Mesh(floorGeometry, floorMaterial);
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = false;
	floor.userData.isEnvironment = true;
	context.scene.add(floor);

	const grid = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
	grid.material.opacity = 0.1;
	grid.material.transparent = true;
	grid.position.y = 0.1;
	context.scene.add(grid);
}
