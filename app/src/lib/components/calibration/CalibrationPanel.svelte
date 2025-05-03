<script>
	import {
		storeTposeCalibration,
		isCalibrated,
		resetCorrections,
		getCurrentCorrections,
		adjustCorrection
	} from '$lib/motion/transform.js';
	import { showCalibration, setCalibrationStatus } from '$lib/stores/motionStore.js';

	let { sensorData = {}, isStreaming = false } = $props();

	let selectedBodyPart = $state('RightUpperArm');
	let showAdjustments = $state(false);
	let adjustmentValues = $state({
		rotation: { x: 0, y: 0, z: 0 },
		inversion: { x: 0, y: 0, z: 0 }
	});

	let countdownActive = $state(false);
	let countdown = $state(3);
	let countdownInterval = $state(null);

	const bodyParts = [
		{ id: 'RightUpperArm', label: 'Right Upper Arm' },
		{ id: 'RightLowerArm', label: 'Right Lower Arm' },
		{ id: 'LeftUpperArm', label: 'Left Upper Arm' },
		{ id: 'LeftLowerArm', label: 'Left Lower Arm' },
		{ id: 'RightUpperLeg', label: 'Right Upper Leg' },
		{ id: 'RightLowerLeg', label: 'Right Lower Leg' },
		{ id: 'LeftUpperLeg', label: 'Left Upper Leg' },
		{ id: 'LeftLowerLeg', label: 'Left Lower Leg' }
	];

	function updateAdjustmentValues() {
		const currentCorrections = getCurrentCorrections();
		if (currentCorrections[selectedBodyPart]) {
			const correction = currentCorrections[selectedBodyPart];

			adjustmentValues.rotation = {
				x: correction.rotationCorrection[0],
				y: correction.rotationCorrection[1],
				z: correction.rotationCorrection[2]
			};

			adjustmentValues.inversion = {
				x: correction.axisInversion[0],
				y: correction.axisInversion[1],
				z: correction.axisInversion[2]
			};
		}
	}

	function captureTPose() {
		if (!isStreaming || !sensorData) {
			alert('Please ensure streaming is active before calibrating');
			return;
		}

		if (countdownInterval) {
			clearInterval(countdownInterval);
		}

		countdownActive = true;
		countdown = 3;

		countdownInterval = setInterval(() => {
			countdown--;

			if (countdown <= 0) {
				clearInterval(countdownInterval);
				countdownInterval = null;
				countdownActive = false;
				executeCalibration();
			}
		}, 1000);
	}

	function executeCalibration() {
		try {
			console.log('Executing T-pose calibration with sensor data:', sensorData);
			const calibrationData = storeTposeCalibration(sensorData);
			setTimeout(() => {
				if (isCalibrated()) {
					setCalibrationStatus(true);
					alert(`T-pose calibration captured successfully!`);
					console.log('Calibration complete - system is now calibrated');
				} else {
					alert('Calibration failed! No valid sensor data captured.');
					console.error('Calibration failed - check sensor data');
				}
			}, 1000);
		} catch (error) {
			console.error('Error during T-pose calibration:', error);
			alert(`Calibration error: ${error.message}`);
		}
	}
	function handleResetCorrections() {
		if (confirm('Reset all sensor corrections to default values?')) {
			resetCorrections();
			updateAdjustmentValues();
		}
	}

	function applyRotationAdjustment(axis, value) {
		const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
		adjustCorrection(selectedBodyPart, 'rotationCorrection', axisIndex, parseFloat(value));
	}

	function applyInversionAdjustment(axis, value) {
		const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
		adjustCorrection(selectedBodyPart, 'axisInversion', axisIndex, value ? 1 : 0);
	}

	function handleRotationChange(axis, event) {
		if (event.currentTarget instanceof HTMLInputElement) {
			applyRotationAdjustment(axis, event.currentTarget.value);
		}
	}

	function handleInversionChange(axis, event) {
		if (event.currentTarget instanceof HTMLInputElement) {
			applyInversionAdjustment(axis, event.currentTarget.checked);
		}
	}

	$effect(() => {
		if (selectedBodyPart) {
			updateAdjustmentValues();
		}
	});
</script>

<div class="rounded-lg bg-white p-4 shadow-md">
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-lg font-semibold">Sensor Calibration</h2>
		<button
			onclick={() => showCalibration.set(false)}
			class="rounded bg-gray-200 px-2 py-1 text-sm hover:bg-gray-300"
		>
			Close
		</button>
	</div>

	<div class="mb-4">
		<div class="mb-2 rounded bg-blue-50 p-3 text-sm">
			<p>
				<span class="font-semibold">Calibration Status:</span>
				{isCalibrated() ? 'Calibrated ✓' : 'Not Calibrated'}
			</p>
			<p class="mt-1 text-xs text-gray-600">
				Stand in T-pose (arms extended to sides) and click "Capture T-Pose". You'll have 3 seconds
				to prepare.
			</p>
		</div>

		{#if countdownActive}
			<div class="mb-3 mt-3 rounded bg-yellow-100 p-3 text-center font-bold text-yellow-800">
				Get ready for T-pose in: {countdown} seconds
			</div>
		{/if}

		<div class="mt-3 flex gap-2">
			<button
				onclick={captureTPose}
				disabled={!isStreaming || countdownActive}
				class="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:bg-blue-300"
			>
				{countdownActive ? `Countdown: ${countdown}` : 'Capture T-Pose'}
			</button>

			<button
				onclick={handleResetCorrections}
				class="rounded border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-100"
			>
				Reset Corrections
			</button>
		</div>
	</div>

	<div class="mb-3">
		<button
			onclick={() => (showAdjustments = !showAdjustments)}
			class="flex w-full items-center justify-between rounded bg-gray-100 px-3 py-2 text-left text-sm font-medium hover:bg-gray-200"
		>
			<span>Advanced Sensor Adjustments</span>
			<span>{showAdjustments ? '−' : '+'}</span>
		</button>
	</div>

	{#if showAdjustments}
		<div class="mb-4 rounded border border-gray-200 p-3">
			<div class="mb-3">
				<label for="body-part-select" class="mb-1 block text-sm font-medium"
					>Select Body Part:</label
				>
				<select
					id="body-part-select"
					bind:value={selectedBodyPart}
					class="w-full rounded border border-gray-300 p-1.5 text-sm"
				>
					{#each bodyParts as part}
						<option value={part.id}>{part.label}</option>
					{/each}
				</select>
			</div>

			<div class="mb-3">
				<h3 class="mb-2 text-sm font-medium">Rotation Adjustments (degrees)</h3>
				<div class="grid grid-cols-3 gap-2">
					<div>
						<label for="x-rotation" class="text-xs">X-Axis</label>
						<input
							id="x-rotation"
							type="number"
							bind:value={adjustmentValues.rotation.x}
							onchange={(e) => handleRotationChange('x', e)}
							min="-180"
							max="180"
							step="15"
							class="w-full rounded border border-gray-300 p-1 text-sm"
						/>
					</div>
					<div>
						<label for="y-rotation" class="text-xs">Y-Axis</label>
						<input
							id="y-rotation"
							type="number"
							bind:value={adjustmentValues.rotation.y}
							onchange={(e) => handleRotationChange('y', e)}
							min="-180"
							max="180"
							step="15"
							class="w-full rounded border border-gray-300 p-1 text-sm"
						/>
					</div>
					<div>
						<label for="z-rotation" class="text-xs">Z-Axis</label>
						<input
							id="z-rotation"
							type="number"
							bind:value={adjustmentValues.rotation.z}
							onchange={(e) => handleRotationChange('z', e)}
							min="-180"
							max="180"
							step="15"
							class="w-full rounded border border-gray-300 p-1 text-sm"
						/>
					</div>
				</div>
			</div>

			<div>
				<h3 class="mb-2 text-sm font-medium">Axis Inversion</h3>
				<div class="grid grid-cols-3 gap-2">
					<div>
						<label for="invert-x" class="flex items-center text-xs">
							<input
								id="invert-x"
								type="checkbox"
								checked={adjustmentValues.inversion.x === 1}
								onchange={(e) => handleInversionChange('x', e)}
								class="mr-1.5"
							/>
							Invert X
						</label>
					</div>
					<div>
						<label for="invert-y" class="flex items-center text-xs">
							<input
								id="invert-y"
								type="checkbox"
								checked={adjustmentValues.inversion.y === 1}
								onchange={(e) => handleInversionChange('y', e)}
								class="mr-1.5"
							/>
							Invert Y
						</label>
					</div>
					<div>
						<label for="invert-z" class="flex items-center text-xs">
							<input
								id="invert-z"
								type="checkbox"
								checked={adjustmentValues.inversion.z === 1}
								onchange={(e) => handleInversionChange('z', e)}
								class="mr-1.5"
							/>
							Invert Z
						</label>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<div class="text-xs text-gray-500">
		<p>Tips:</p>
		<ul class="ml-4 list-disc">
			<li>Stand in a proper T-pose before calibrating (arms extended horizontally)</li>
			<li>Ensure all sensors are attached correctly before calibration</li>
			<li>Use advanced adjustments only if movements appear incorrect</li>
		</ul>
	</div>
</div>
