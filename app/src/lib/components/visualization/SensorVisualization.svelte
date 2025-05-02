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
		debugEnabled,
		showCalibration,
		bodyProportions,
		recordedAnimations,
		currentPlayback,
		isRecording
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

	// Import calibration-related components
	import CalibrationPanel from '$lib/components/calibration/CalibrationPanel.svelte';
	import RecordingPanel from '$lib/components/playback/RecordingPanel.svelte';

	// Props using Svelte 5 runes syntax
	let { data = {}, isConnected = false } = $props();

	// Local state with Svelte 5 $state rune
	let container;
	let sceneContext = $state(null);
	let initialized = $state(false);
	let currentModelId = $state('');
	let frameCount = $state(0);
	let lastSequence = $state(0);
	let showRecording = $state(false);

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

			// Apply body proportions when model changes
			applyBodyProportions();

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

	// Apply body proportions to the model
	function applyBodyProportions() {
		if (!sceneContext || !sceneContext.model) return;

		// For basic model, apply scaling directly
		if (currentModelId === 'basic' && sceneContext.basicModelParts) {
			// Apply arm length scaling
			const armScale = $bodyProportions.armLength;
			if (
				sceneContext.basicModelParts.rightUpperArm &&
				sceneContext.basicModelParts.rightUpperArm.limb
			) {
				sceneContext.basicModelParts.rightUpperArm.limb.scale.y = armScale;
				sceneContext.basicModelParts.leftUpperArm.limb.scale.y = armScale;
				sceneContext.basicModelParts.rightLowerArm.limb.scale.y = armScale;
				sceneContext.basicModelParts.leftLowerArm.limb.scale.y = armScale;
			}

			// Apply leg length scaling
			const legScale = $bodyProportions.legLength;
			if (
				sceneContext.basicModelParts.rightUpperLeg &&
				sceneContext.basicModelParts.rightUpperLeg.limb
			) {
				sceneContext.basicModelParts.rightUpperLeg.limb.scale.y = legScale;
				sceneContext.basicModelParts.leftUpperLeg.limb.scale.y = legScale;
				sceneContext.basicModelParts.rightLowerLeg.limb.scale.y = legScale;
				sceneContext.basicModelParts.leftLowerLeg.limb.scale.y = legScale;
			}

			// Reposition joints after scaling
			updateJointPositions();
		}
		// For loaded models, scale the entire model
		else if (currentModelId !== 'basic') {
			const overallScale = $bodyProportions.height;
			sceneContext.model.scale.set(overallScale, overallScale, overallScale);
		}
	}

	// Update joint positions based on limb scaling
	function updateJointPositions() {
		if (currentModelId !== 'basic' || !sceneContext.basicModelParts) return;

		// Update lower arm joint positions based on upper arm scaling
		const armScale = $bodyProportions.armLength;
		const LIMB_LENGTH = 40; // Same as in models.js

		// Right arm
		if (sceneContext.basicModelParts.rightUpperArm && sceneContext.basicModelParts.rightLowerArm) {
			const rightUpperArm = sceneContext.basicModelParts.rightUpperArm;
			const rightLowerArm = sceneContext.basicModelParts.rightLowerArm;

			rightLowerArm.joint.position.y = rightUpperArm.joint.position.y - LIMB_LENGTH * armScale;
		}

		// Left arm
		if (sceneContext.basicModelParts.leftUpperArm && sceneContext.basicModelParts.leftLowerArm) {
			const leftUpperArm = sceneContext.basicModelParts.leftUpperArm;
			const leftLowerArm = sceneContext.basicModelParts.leftLowerArm;

			leftLowerArm.joint.position.y = leftUpperArm.joint.position.y - LIMB_LENGTH * armScale;
		}

		// Update lower leg joint positions based on upper leg scaling
		const legScale = $bodyProportions.legLength;

		// Right leg
		if (sceneContext.basicModelParts.rightUpperLeg && sceneContext.basicModelParts.rightLowerLeg) {
			const rightUpperLeg = sceneContext.basicModelParts.rightUpperLeg;
			const rightLowerLeg = sceneContext.basicModelParts.rightLowerLeg;

			rightLowerLeg.joint.position.y = rightUpperLeg.joint.position.y - LIMB_LENGTH * legScale;
		}

		// Left leg
		if (sceneContext.basicModelParts.leftUpperLeg && sceneContext.basicModelParts.leftLowerLeg) {
			const leftUpperLeg = sceneContext.basicModelParts.leftUpperLeg;
			const leftLowerLeg = sceneContext.basicModelParts.leftLowerLeg;

			leftLowerLeg.joint.position.y = leftUpperLeg.joint.position.y - LIMB_LENGTH * legScale;
		}
	}

	// Animation loop using requestAnimationFrame instead of effect
	function startAnimation() {
		if (animationFrame) return;

		function animate() {
			animationFrame = requestAnimationFrame(animate);

			// Process data only every 2-3 frames for better performance
			if (frameCount++ % 3 === 0 && initialized && sceneContext && data) {
				processSensorData();
			}
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

	// Reset model pose to default
	function handleResetPose() {
		if (sceneContext) {
			resetModelPose(sceneContext);
		}
	}

	// Toggle calibration panel
	function handleToggleCalibration() {
		showCalibration.update((value) => !value);
	}

	// Toggle recording panel
	function handleToggleRecording() {
		showRecording = !showRecording;
	}

	// Update body proportion
	function updateProportion(property, value) {
		bodyProportions.update((current) => ({
			...current,
			[property]: parseFloat(value)
		}));

		// Apply changes
		applyBodyProportions();
	}

	// Handle input event for body proportion sliders
	function handleProportionChange(property, event) {
		if (event.currentTarget instanceof HTMLInputElement) {
			updateProportion(property, event.currentTarget.value);
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

				// Apply body proportions after model loading
				applyBodyProportions();

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

	// Track body proportion changes
	$effect(() => {
		// When body proportions change, apply them
		if (
			initialized &&
			sceneContext &&
			($bodyProportions.armLength || $bodyProportions.legLength || $bodyProportions.height)
		) {
			applyBodyProportions();
		}
	});
</script>

<div class="flex h-full flex-col">
	<!-- Main controls bar -->
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

		<div class="flex items-center">
			<button
				onclick={handleResetPose}
				class="mr-2 rounded bg-blue-100 px-2 py-1 text-xs text-blue-800 hover:bg-blue-200"
				title="Reset to T-pose position"
			>
				Reset Pose
			</button>

			<label class="flex items-center">
				<input
					type="checkbox"
					checked={$showSkeleton}
					onclick={handleSkeletonToggle}
					class="mr-1"
				/>
				<span class="text-sm">Show Skeleton</span>
			</label>
		</div>

		<div class="ml-auto flex items-center gap-2">
			<button
				onclick={handleToggleCalibration}
				class="rounded bg-purple-100 px-2 py-1 text-xs text-purple-800 hover:bg-purple-200"
				class:bg-purple-600={$showCalibration}
				class:text-white={$showCalibration}
				class:hover:bg-purple-700={$showCalibration}
			>
				{$showCalibration ? 'Hide Calibration' : 'Calibration'}
			</button>

			<button
				onclick={handleToggleRecording}
				class="rounded bg-red-100 px-2 py-1 text-xs text-red-800 hover:bg-red-200"
				class:bg-red-600={showRecording}
				class:text-white={showRecording}
				class:hover:bg-red-700={showRecording}
			>
				{showRecording ? 'Hide Recorder' : 'Recorder'}
			</button>

			<label class="flex items-center">
				<input type="checkbox" checked={$debugMode} onclick={handleDebugToggle} class="mr-1" />
				<span class="text-sm">Debug</span>
			</label>
		</div>
	</div>

	<!-- Body proportions controls -->
	<div class="mb-2 flex flex-wrap items-center gap-3 bg-gray-50 px-3 py-2 text-sm">
		<div class="flex items-center">
			<label for="arm-length" class="mr-1">Arms:</label>
			<input
				id="arm-length"
				type="range"
				min="0.5"
				max="1.5"
				step="0.05"
				value={$bodyProportions.armLength}
				onchange={(e) => handleProportionChange('armLength', e)}
				class="w-24"
			/>
			<span class="ml-1 w-8 text-xs">{$bodyProportions.armLength.toFixed(2)}x</span>
		</div>

		<div class="flex items-center">
			<label for="leg-length" class="mr-1">Legs:</label>
			<input
				id="leg-length"
				type="range"
				min="0.5"
				max="1.5"
				step="0.05"
				value={$bodyProportions.legLength}
				onchange={(e) => handleProportionChange('legLength', e)}
				class="w-24"
			/>
			<span class="ml-1 w-8 text-xs">{$bodyProportions.legLength.toFixed(2)}x</span>
		</div>

		<div class="flex items-center">
			<label for="body-height" class="mr-1">Height:</label>
			<input
				id="body-height"
				type="range"
				min="0.5"
				max="1.5"
				step="0.05"
				value={$bodyProportions.height}
				onchange={(e) => handleProportionChange('height', e)}
				class="w-24"
			/>
			<span class="ml-1 w-8 text-xs">{$bodyProportions.height.toFixed(2)}x</span>
		</div>

		<button
			onclick={() => {
				bodyProportions.set({
					armLength: 1.0,
					legLength: 1.0,
					shoulderWidth: 1.0,
					height: 1.0
				});
				applyBodyProportions();
			}}
			class="rounded bg-gray-200 px-2 py-0.5 text-xs hover:bg-gray-300"
		>
			Reset
		</button>
	</div>

	<!-- Side panels -->
	<div class="relative flex-grow">
		<!-- Calibration panel overlay -->
		{#if $showCalibration}
			<div class="absolute right-0 top-0 z-10 w-80 p-2">
				<CalibrationPanel
					sensorData={data}
					isStreaming={isConnected && Object.keys(data).length > 0}
				/>
			</div>
		{/if}

		<!-- Recording panel overlay -->
		{#if showRecording}
			<div class="absolute left-0 top-0 z-10 w-80 p-2">
				<RecordingPanel {isConnected} isStreaming={isConnected && Object.keys(data).length > 0} />
			</div>
		{/if}

		<!-- Playback indicator -->
		{#if $currentPlayback}
			<div
				class="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded bg-blue-600 px-3 py-1 text-sm text-white shadow-md"
			>
				<div class="flex items-center">
					<span class="mr-2 flex h-2 w-2 items-center">
						<span class="relative h-2 w-2 rounded-full bg-blue-300"></span>
					</span>
					<span>Playing: {$currentPlayback.name}</span>
				</div>
			</div>
		{/if}

		<!-- Recording indicator -->
		{#if $isRecording}
			<div
				class="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded bg-red-600 px-3 py-1 text-sm text-white shadow-md"
			>
				<div class="flex items-center">
					<span class="mr-2 flex h-2 w-2 items-center">
						<span class="absolute h-2 w-2 animate-ping rounded-full bg-white"></span>
						<span class="relative h-2 w-2 rounded-full bg-red-300"></span>
					</span>
					<span>Recording...</span>
				</div>
			</div>
		{/if}

		<!-- Canvas container -->
		<div bind:this={container} class="h-full w-full"></div>
	</div>

	<!-- Loader overlay -->
	{#if $loading}
		<div class="absolute inset-0 z-20 flex items-center justify-center bg-black bg-opacity-30">
			<div class="rounded bg-white p-4 shadow-lg">
				<p class="text-lg">Loading model…</p>
			</div>
		</div>
	{/if}

	<!-- Inactive state -->
	{#if !isConnected && !$currentPlayback}
		<div class="absolute inset-0 z-10 flex items-center justify-center bg-gray-100 bg-opacity-80">
			<div class="rounded bg-white p-4 text-center shadow-md">
				<h3 class="mb-2 text-lg font-medium text-gray-800">Visualization Inactive</h3>
				<p class="text-gray-600">
					Connect to the system and start streaming to see sensor data visualization.
					<br />
					Or use the Recorder to play back previously recorded motion.
				</p>
			</div>
		</div>
	{/if}
</div>
