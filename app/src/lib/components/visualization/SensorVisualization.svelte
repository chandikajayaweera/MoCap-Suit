<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import {
		selectedModel,
		selectedEnvironment,
		showSkeleton,
		debugMode,
		loading,
		setLoading
	} from '$lib/stores/motionStore.js';

	import ModelSelector from './ModelSelector.svelte';
	import EnvironmentSelector from './EnvironmentSelector.svelte';
	import { setupScene, cleanupScene } from '$lib/three/engine.js';
	import { createBasicModel, loadModel } from '$lib/three/models.js';
	import { applyEnvironment } from '$lib/three/environments.js';
	import {
		updateModelWithSensorData,
		setSkeletonVisibility,
		resetModelPose,
		exposeModelInfo
	} from '$lib/three/animation.js';

	import { getTHREE } from '$lib/three/engine.js';
	import { getSensorsWithData } from '$lib/motion/sensors.js';

	// Props using Svelte 5 runes syntax
	let { data, isConnected = false } = $props();

	// Local state
	let container;
	let sceneContext = null;
	let initialized = false;
	let currentModelId = '';
	// FIX: Track last update to avoid overly frequent updates
	let lastUpdateTime = 0;
	let updateDebounce = 16; // ~60fps max update rate

	// Add error state tracking
	let hasError = $state(false);
	let errorMessage = $state('');

	const directBoneMappings = {
		S0: ['mixamorig:RightLeg', 'mixamorig.RightLeg', 'RightLeg', 'mixamorig3:RightLeg'],
		S1: ['mixamorig:RightUpLeg', 'mixamorig.RightUpLeg', 'RightUpLeg', 'mixamorig3:RightUpLeg'],
		S2: ['mixamorig:LeftLeg', 'mixamorig.LeftLeg', 'LeftLeg', 'mixamorig3:LeftLeg'],
		S3: ['mixamorig:LeftUpLeg', 'mixamorig.LeftUpLeg', 'LeftUpLeg', 'mixamorig3:LeftUpLeg'],
		S4: ['mixamorig:LeftForeArm', 'mixamorig.LeftForeArm', 'LeftForeArm', 'mixamorig3:LeftForeArm'],
		S5: ['mixamorig:LeftArm', 'mixamorig.LeftArm', 'LeftArm', 'mixamorig3:LeftArm'],
		S6: [
			'mixamorig:RightForeArm',
			'mixamorig.RightForeArm',
			'RightForeArm',
			'mixamorig3:RightForeArm'
		],
		S7: ['mixamorig:RightArm', 'mixamorig.RightArm', 'RightArm', 'mixamorig3:RightArm']
	};

	// Direct DOM event handlers for model and environment changes
	function handleModelChange(event) {
		const newModelId = event.target.value;
		console.log(`Model changed via select: ${newModelId}`);
		selectedModel.set(newModelId);
		changeModel(newModelId);
	}

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
			// Clear error state on model change
			hasError = false;
			errorMessage = '';

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
			hasError = true;
			errorMessage = `Failed to load model: ${err.message || 'Unknown error'}`;
		} finally {
			setLoading(false);
		}
	}

	// Direct environment change function
	function changeEnvironment(envId) {
		if (!sceneContext || !initialized) return;

		console.log(`Changing environment to: ${envId}`);
		applyEnvironment(sceneContext, envId);
	}

	$effect(() => {
		console.log(
			'DATA:',
			Object.keys(data).filter((k) => k.startsWith('S'))
		);
		console.log('BONE SEARCH:', window.__bones); // The bone names from your model
		if (!initialized || !sceneContext || !data || !isConnected) return;

		if (!data) return;

		// Direct bone manipulation based on sensor data
		Object.keys(data).forEach((key) => {
			if (!key.startsWith('S') || !Array.isArray(data[key]) || data[key].length !== 4) return;

			const possibleBoneNames = directBoneMappings[key] || [];
			const [w, x, y, z] = data[key];

			// Try each possible bone name
			let found = false;
			for (const boneName of possibleBoneNames) {
				const bone = sceneContext.model.getObjectByName(boneName);
				if (bone) {
					bone.quaternion.set(x, y, z, w);
					bone.quaternion.normalize();
					bone.updateMatrix();
					bone.updateMatrixWorld(true);
					found = true;
					break;
				}
			}

			if ($debugMode && !found && data.sequence % 50 === 0) {
				console.log(`No matching bone found for sensor ${key}`);
			}
		});
	});

	// Toggle skeleton visibility with DIRECT update to the skeleton
	function handleSkeletonToggle() {
		// Store the new value to ensure consistency
		const newValue = !$showSkeleton;

		// Update the store
		showSkeleton.set(newValue);

		// Directly update the skeleton visibility with the same value
		if (sceneContext && sceneContext.skeleton) {
			console.log(`Directly setting skeleton visibility to: ${newValue}`);
			sceneContext.skeleton.visible = newValue;
		}
	}

	// Toggle debug mode
	function handleDebugToggle() {
		const newValue = !$debugMode;
		debugMode.set(newValue);

		if (newValue) {
			console.log('Debug mode enabled - additional logging will be shown');
		} else {
			console.log('Debug mode disabled');
		}
	}

	onMount(() => {
		if (sceneContext && sceneContext.model) {
			// Expose model info for debugging
			exposeModelInfo(sceneContext);
		}
		if (!browser) return;

		(async () => {
			try {
				console.log('Setting up 3D scene');
				sceneContext = await setupScene(container);

				// Configure camera and controls for better movement
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

				// Initialize with starting model and environment
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

				// Set skeleton visibility based on store value
				if (sceneContext.skeleton) {
					const skeletonVisible = $showSkeleton;
					console.log(`Initial skeleton visibility: ${skeletonVisible}`);
					sceneContext.skeleton.visible = skeletonVisible;
				}

				initialized = true;
				setLoading(false);
				console.log('3D scene initialized successfully');
			} catch (err) {
				console.error('Error initializing 3D scene:', err);
				setLoading(false);
				hasError = true;
				errorMessage = `Failed to initialize scene: ${err.message || 'Unknown error'}`;
			}
		})();

		return () => {
			if (sceneContext) {
				console.log('Cleaning up 3D scene');
				cleanupScene(sceneContext);
				sceneContext = null;
			}
		};
	});
	/*
	setTimeout(() => {
		console.log('DIRECT MODEL INSPECTION');
		if (sceneContext && sceneContext.model) {
			// Log all bones
			const bones = [];
			sceneContext.model.traverse((obj) => {
				if (obj.type === 'Bone' || obj.isBone) {
					bones.push(obj.name);

					// FORCE MOVEMENT to test if bone control works at all
					obj.rotation.x = (Math.random() * Math.PI) / 4;
					obj.updateMatrix();
					obj.updateMatrixWorld(true);
				}
			});
			console.log('ALL MODEL BONES:', bones);

			// Make model info globally accessible
			window.__modelBones = bones;
		}
	}, 2000); // Delay to ensure model is loaded*/

	// Add to onMount
	setTimeout(() => {
		console.log('EXACT BONE NAMES:');
		const allBones = [];
		sceneContext.model.traverse((obj) => {
			if (obj.isBone || obj.type === 'Bone') {
				allBones.push(obj.name);
			}
		});
		console.log(allBones);
		window.__bones = allBones; // Access in console
	}, 2000);

	onDestroy(() => {
		if (sceneContext) cleanupScene(sceneContext);
	});
</script>

# SensorVisualization.svelte

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

	<!-- Error state -->
	{#if hasError}
		<div class="absolute inset-0 z-10 flex items-center justify-center bg-red-100 bg-opacity-30">
			<div class="rounded bg-white p-4 text-center shadow-lg">
				<h3 class="mb-2 text-lg font-medium text-red-800">Visualization Error</h3>
				<p class="text-red-600">{errorMessage}</p>
				<button
					onclick={() => {
						hasError = false;
						errorMessage = '';
					}}
					class="mt-2 rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
				>
					Dismiss
				</button>
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
