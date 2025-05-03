let THREE;
let OrbitControls;

async function initModules() {
	if (THREE) return;

	THREE = await import('three');
	const OrbitControlsModule = await import('three/examples/jsm/controls/OrbitControls.js');
	OrbitControls = OrbitControlsModule.OrbitControls;
}

export async function setupScene(container, options = {}) {
	if (!container) {
		throw new Error('Container element is required');
	}

	await initModules();

	const context = {
		container,
		scene: new THREE.Scene(),
		camera: null,
		renderer: null,
		controls: null,
		clock: new THREE.Clock(),
		mixer: null,
		model: null,
		skeleton: null,
		frameId: null,
		loading: false,

		basicModelParts: {},

		isAnimating: false
	};

	context.camera = new THREE.PerspectiveCamera(
		75,
		container.clientWidth / container.clientHeight,
		0.1,
		1000
	);
	context.camera.position.set(0, 100, 200);

	context.renderer = new THREE.WebGLRenderer({
		antialias: true,
		alpha: true,
		...options.renderer
	});
	context.renderer.setSize(container.clientWidth, container.clientHeight);
	context.renderer.setPixelRatio(window.devicePixelRatio);
	context.renderer.shadowMap.enabled = true;
	context.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	container.appendChild(context.renderer.domElement);

	context.controls = new OrbitControls(context.camera, context.renderer.domElement);
	context.controls.enableDamping = true;
	context.controls.dampingFactor = 0.05;
	context.controls.target.set(0, 100, 0);

	const handleResize = () => {
		if (!container) return;

		context.camera.aspect = container.clientWidth / container.clientHeight;
		context.camera.updateProjectionMatrix();
		context.renderer.setSize(container.clientWidth, container.clientHeight);
	};

	window.addEventListener('resize', handleResize);

	context.startAnimation = () => {
		if (context.isAnimating) return;

		context.isAnimating = true;
		const animate = () => {
			if (!context.isAnimating) return;

			context.frameId = requestAnimationFrame(animate);

			if (context.controls) {
				context.controls.update();
			}

			if (context.mixer) {
				const delta = context.clock.getDelta();
				context.mixer.update(delta);
			}

			if (context.renderer && context.scene && context.camera) {
				context.renderer.render(context.scene, context.camera);
			}
		};

		animate();
	};

	context.stopAnimation = () => {
		context.isAnimating = false;
		if (context.frameId) {
			cancelAnimationFrame(context.frameId);
			context.frameId = null;
		}
	};

	context.startAnimation();

	context.cleanup = () => {
		context.stopAnimation();

		window.removeEventListener('resize', handleResize);

		if (context.controls) {
			context.controls.dispose();
		}

		if (context.renderer) {
			if (container.contains(context.renderer.domElement)) {
				container.removeChild(context.renderer.domElement);
			}
			context.renderer.dispose();
		}

		if (context.scene) {
			while (context.scene.children.length > 0) {
				const object = context.scene.children[0];
				context.scene.remove(object);

				if (object.geometry) object.geometry.dispose();

				if (object.material) {
					if (Array.isArray(object.material)) {
						object.material.forEach((material) => material.dispose());
					} else {
						object.material.dispose();
					}
				}
			}
		}
	};

	return context;
}

export function cleanupScene(context) {
	if (!context) return;

	if (typeof context.cleanup === 'function') {
		context.cleanup();
	}
}

export async function getTHREE() {
	await initModules();
	return THREE;
}

export async function getGLTFLoader() {
	await initModules();
	const GLTFLoaderModule = await import('three/examples/jsm/loaders/GLTFLoader.js');
	return GLTFLoaderModule.GLTFLoader;
}
