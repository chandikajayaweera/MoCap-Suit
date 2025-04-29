<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import {
		selectedModel,
		selectedEnvironment,
		showSkeleton,
		debugMode,
		loading,
		setLoading,
		debugEnabled
	} from '$lib/stores/motionStore.js';

	import { setupScene, cleanupScene } from '$lib/three/engine.js';
	import { createBasicModel, loadModel } from '$lib/three/models.js';
	import { applyEnvironment } from '$lib/three/environments.js';
	import {
		updateModelWithSensorData,
		setSkeletonVisibility,
		resetModelPose
	} from '$lib/three/animation.js';
	import { resetDataFormatCache } from '$lib/motion/sensors.js';

	// Props using Svelte 5 runes syntax
	let { data = {}, isConnected = false } = $props();

	// Local state with Svelte 5 $state rune
	let container;
	let sceneContext = $state(null);
	let initialized = $state(false);
	let currentModelId = $state('');
	let frameCount = $state(0);
	let lastSequence = $state(0);

	// Animation frame reference
	let animationFrame = null;

	// Model change handler using Svelte 5 event syntax
	function handleModelChange(event) {
		const newModelId = event.target.value;
		console.log(`Model changed via select: ${newModelId}`);
		selectedModel.set(newModelId);
		changeModel(newModelId);
	}

	// Environment change handler
	function handleEnvironmentChange(event) {
		const newEnvId = event.target.value;
		console.log(`Environment changed via select: ${newEnvId}`);
		selectedEnvironment.set(newEnvId);
		changeEnvironment(newEnvId);
	}

	// Direct model change function
	async function changeModel(modelId) {
		if (!sceneContext || !initialized) return;

		console.log(`Changing model directly to: ${modelId} (current: ${currentModelId})`);

		// Skip if same model
		if (modelId === currentModelId) {
			console.log('Model unchanged, skipping reload');
			return;
		}

		setLoading(true);
		try {
			// Reset data format cache when changing models
			resetDataFormatCache();

			// First clear previous model
			if (sceneContext.model) {
				console.log('Removing previous model');
				sceneContext.scene.remove(sceneContext.model);
				sceneContext.model = null;
			}

			// Clear previous skeleton helper
			if (sceneContext.skeleton) {
				console.log('Removing previous skeleton');
				sceneContext.scene.remove(sceneContext.skeleton);
				sceneContext.skeleton = null;
			}

			console.log(`Loading new model: ${modelId}`);
			if (modelId === 'basic') {
				await createBasicModel(sceneContext);
			} else {
				await loadModel(sceneContext, modelId);
			}

			currentModelId = modelId;
			console.log(`Model successfully changed to: ${modelId}`);

			// Update skeleton visibility immediately after loading
			if (sceneContext.skeleton) {
				const skeletonVisible = $showSkeleton;
				console.log(`Setting skeleton visibility to: ${skeletonVisible}`);
				sceneContext.skeleton.visible = skeletonVisible;
			}
		} catch (err) {
			console.error('Error changing model:', err);
		} finally {
			setLoading(false);
		}
	}

	// Environment change function
	function changeEnvironment(envId) {
		if (!sceneContext || !initialized) return;

		console.log(`Changing environment to: ${envId}`);
		applyEnvironment(sceneContext, envId);
	}

	// Animation loop using requestAnimationFrame instead of effect
	function startAnimation() {
		if (animationFrame) return;

		function animate() {
			frameCount++;

			// Process data at appropriate intervals (every ~200ms)
			if (initialized && sceneContext && data && frameCount % 12 === 0) {
				processSensorData();
			}

			animationFrame = requestAnimationFrame(animate);
		}

		animate();
	}

	function stopAnimation() {
		if (animationFrame) {
			cancelAnimationFrame(animationFrame);
			animationFrame = null;
		}
	}

	// Process sensor data without triggering reactive updates
	function processSensorData() {
		// Check for new data via sequence
		let hasNewData = true;

		if ('sequence' in data) {
			hasNewData = data.sequence !== lastSequence;
			if (hasNewData) {
				lastSequence = data.sequence;
			}
		}

		// Only process if we have new data
		if (!hasNewData) return;

		// Log data occasionally for debugging
		if ($debugMode && lastSequence % 100 === 0) {
			console.log('Processing sensor data:', {
				sequence: lastSequence,
				sensorCount: Object.keys(data).filter((k) => k.startsWith('S')).length
			});
		}

		// Apply to model - try both data formats
		if (data.sensorData) {
			updateModelWithSensorData(sceneContext, data.sensorData, currentModelId);
		} else if (typeof data === 'object' && Object.keys(data).some((k) => k.startsWith('S'))) {
			updateModelWithSensorData(sceneContext, data, currentModelId);
		}
	}

	// Watch data changes with a reactive statement, but don't call processSensorData directly
	// This prevents infinite loops while still tracking when data changes
	$effect(() => {
		if (data && 'sequence' in data) {
			// Just access data.sequence to create a dependency
			// This ensures the effect runs when sequence changes
			const seq = data.sequence;

			// Don't do anything else here - the animation loop handles updates
			if ($debugMode && seq % 500 === 0) {
				console.log(`Data sequence updated to ${seq}`);
			}
		}
	});

	// Toggle skeleton visibility
	function handleSkeletonToggle() {
		const newValue = !$showSkeleton;
		showSkeleton.set(newValue);

		if (sceneContext && sceneContext.skeleton) {
			console.log(`Setting skeleton visibility to: ${newValue}`);
			sceneContext.skeleton.visible = newValue;
		}
	}

	// Toggle debug mode
	function handleDebugToggle() {
		const newValue = !$debugMode;
		debugMode.set(newValue);

		if (newValue && sceneContext && sceneContext.model) {
			console.log('===== DEBUG MODE ENABLED =====');
			console.log(`Current model: ${currentModelId}`);

			if (data) {
				console.log('Current data:', data);
				const sensorKeys = Object.keys(data).filter((k) => k.startsWith('S'));
				console.log(`Sensor keys found: ${sensorKeys.length}`, sensorKeys);

				if (sensorKeys.length > 0) {
					const firstKey = sensorKeys[0];
					console.log(`Sample sensor data (${firstKey}):`, data[firstKey]);
				}
			}

			// Force bone structure analysis on next update
			if (sceneContext) {
				sceneContext.bonesLogged = false;
			}

			console.log('Attempting to reset model pose...');
			resetModelPose(sceneContext);
		}
	}

	onMount(() => {
		if (!browser) return;

		(async () => {
			try {
				console.log('Setting up 3D scene');
				sceneContext = await setupScene(container);

				// Configure camera and controls
				if (sceneContext.camera) {
					sceneContext.camera.position.set(0, 100, 200);
				}

				if (sceneContext.controls) {
					sceneContext.controls.enableDamping = true;
					sceneContext.controls.dampingFactor = 0.05;
					sceneContext.controls.screenSpacePanning = true;
					sceneContext.controls.minDistance = 50;
					sceneContext.controls.maxDistance = 500;
					sceneContext.controls.maxPolarAngle = Math.PI * 0.8;
					sceneContext.controls.target.set(0, 100, 0);
				}

				// Initialize model and environment
				const initialModelId = $selectedModel;
				const initialEnvId = $selectedEnvironment;

				console.log(`Initial setup with model: ${initialModelId}, env: ${initialEnvId}`);
				applyEnvironment(sceneContext, initialEnvId);

				setLoading(true);
				if (initialModelId === 'basic') {
					await createBasicModel(sceneContext);
				} else {
					await loadModel(sceneContext, initialModelId);
				}
				currentModelId = initialModelId;

				// Set skeleton visibility
				if (sceneContext.skeleton) {
					const skeletonVisible = $showSkeleton;
					console.log(`Initial skeleton visibility: ${skeletonVisible}`);
					sceneContext.skeleton.visible = skeletonVisible;
				}

				initialized = true;
				setLoading(false);
				console.log('3D scene initialized successfully');

				// Start animation loop
				startAnimation();
			} catch (err) {
				console.error('Error initializing 3D scene:', err);
				setLoading(false);
			}
		})();

		return () => {
			stopAnimation();
			if (sceneContext) cleanupScene(sceneContext);
		};
	});

	onDestroy(() => {
		stopAnimation();
		if (sceneContext) cleanupScene(sceneContext);
	});
</script>

<div class="flex h-full flex-col">
	<!-- Controls bar -->
	<div class="mb-2 flex flex-wrap items-center gap-2 bg-gray-100 p-2">
		<div>
			<label for="model-select" class="mr-2 text-sm font-medium">Model:</label>
			<select
				id="model-select"
				value={$selectedModel}
				onchange={handleModelChange}
				disabled={$loading}
				class="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
			>
				<option value="basic">Basic Model</option>
				<option value="xbot">X Bot</option>
				<option value="amy">Amy (Girl)</option>
			</select>
		</div>

		<div>
			<label for="env-select" class="mr-2 text-sm font-medium">Environment:</label>
			<select
				id="env-select"
				value={$selectedEnvironment}
				onchange={handleEnvironmentChange}
				class="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
			>
				<option value="studio">Studio</option>
				<option value="outdoor">Outdoor</option>
				<option value="dark">Dark Room</option>
				<option value="grid">Grid Only</option>
				<option value="shadowless">Shadowless Studio</option>
			</select>
		</div>

		<label class="flex items-center">
			<input type="checkbox" checked={$showSkeleton} onclick={handleSkeletonToggle} class="mr-1" />
			Show Skeleton
		</label>

		<label class="ml-auto flex items-center">
			<input type="checkbox" checked={$debugMode} onclick={handleDebugToggle} class="mr-1" />
			Debug Mode
		</label>
	</div>

	<!-- Loader overlay -->
	{#if $loading}
		<div class="absolute inset-0 z-10 flex items-center justify-center bg-black bg-opacity-30">
			<div class="rounded bg-white p-4 shadow-lg">
				<p class="text-lg">Loading model…</p>
			</div>
		</div>
	{/if}

	<!-- Inactive state -->
	{#if !isConnected}
		<div class="absolute inset-0 z-10 flex items-center justify-center bg-gray-100 bg-opacity-80">
			<div class="rounded bg-white p-4 text-center shadow-md">
				<h3 class="mb-2 text-lg font-medium text-gray-800">Visualization Inactive</h3>
				<p class="text-gray-600">
					Connect to the system and start streaming to see sensor data visualization.
				</p>
			</div>
		</div>
	{/if}

	<!-- Canvas container -->
	<div bind:this={container} class="relative flex-grow"></div>
</div>
