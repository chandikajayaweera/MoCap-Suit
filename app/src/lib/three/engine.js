// Three.js scene setup and management

// Dynamic imports to avoid SSR issues
let THREE;
let OrbitControls;

// Initialize core modules
async function initModules() {
	if (THREE) return;

	THREE = await import('three');
	const OrbitControlsModule = await import('three/examples/jsm/controls/OrbitControls.js');
	OrbitControls = OrbitControlsModule.OrbitControls;
}

// Create a Three.js scene context
export async function setupScene(container, options = {}) {
	if (!container) {
		throw new Error('Container element is required');
	}

	await initModules();

	// Create scene context
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

		// Model parts for basic model
		basicModelParts: {},

		// Animation loop active
		isAnimating: false
	};

	// Create camera
	context.camera = new THREE.PerspectiveCamera(
		75,
		container.clientWidth / container.clientHeight,
		0.1,
		1000
	);
	context.camera.position.set(0, 100, 200);

	// Create renderer
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

	// Create controls
	context.controls = new OrbitControls(context.camera, context.renderer.domElement);
	context.controls.enableDamping = true;
	context.controls.dampingFactor = 0.05;
	context.controls.target.set(0, 100, 0);

	// Handle window resize
	const handleResize = () => {
		if (!container) return;

		context.camera.aspect = container.clientWidth / container.clientHeight;
		context.camera.updateProjectionMatrix();
		context.renderer.setSize(container.clientWidth, container.clientHeight);
	};

	window.addEventListener('resize', handleResize);

	// Start animation loop
	context.startAnimation = () => {
		if (context.isAnimating) return;

		context.isAnimating = true;
		const animate = () => {
			if (!context.isAnimating) return;

			context.frameId = requestAnimationFrame(animate);

			// Update controls
			if (context.controls) {
				context.controls.update();
			}

			// Update mixer if it exists
			if (context.mixer) {
				const delta = context.clock.getDelta();
				context.mixer.update(delta);
			}

			// Render the scene
			if (context.renderer && context.scene && context.camera) {
				context.renderer.render(context.scene, context.camera);
			}
		};

		animate();
	};

	// Stop animation loop
	context.stopAnimation = () => {
		context.isAnimating = false;
		if (context.frameId) {
			cancelAnimationFrame(context.frameId);
			context.frameId = null;
		}
	};

	// Start the animation loop
	context.startAnimation();

	// Add cleanup method to context
	context.cleanup = () => {
		// Stop animation loop
		context.stopAnimation();

		// Remove event listeners
		window.removeEventListener('resize', handleResize);

		// Dispose of Three.js resources
		if (context.controls) {
			context.controls.dispose();
		}

		if (context.renderer) {
			if (container.contains(context.renderer.domElement)) {
				container.removeChild(context.renderer.domElement);
			}
			context.renderer.dispose();
		}

		// Clear all objects from scene
		if (context.scene) {
			while (context.scene.children.length > 0) {
				const object = context.scene.children[0];
				context.scene.remove(object);

				// Recursively dispose of geometries and materials
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

// Clean up Three.js resources
export function cleanupScene(context) {
	if (!context) return;

	if (typeof context.cleanup === 'function') {
		context.cleanup();
	}
}

// Get THREE module
export async function getTHREE() {
	await initModules();
	return THREE;
}

// Get the GLTFLoader module
export async function getGLTFLoader() {
	await initModules();
	const GLTFLoaderModule = await import('three/examples/jsm/loaders/GLTFLoader.js');
	return GLTFLoaderModule.GLTFLoader;
}
