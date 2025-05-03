import { writable, derived, get } from 'svelte/store';

export const connected = writable(false);
export const sensorData = writable({});
export const selectedModel = writable('xbot');
export const selectedEnvironment = writable('studio');
export const showSkeleton = writable(false);
export const debugMode = writable(false);
export const showCalibration = writable(false);
export const calibrationStatus = writable({
	isCalibrated: false,
	tPoseTimestamp: null
});
export const loading = writable(false);
export const dataRate = writable(0);
export const bodyProportions = writable({
	armLength: 1.0,
	legLength: 1.0,
	shoulderWidth: 1.0,
	height: 1.0
});
export const updateCount = writable(0);
export const mappingStats = writable({
	totalSensors: 0,
	mappedSensors: 0,
	lastUpdate: 0
});
export const recordedAnimations = writable([]);
export const currentPlayback = writable(null);
export const isRecording = writable(false);
export const playbackProgress = writable(0);

debugMode.subscribe((value) => {
	if (typeof window !== 'undefined') {
		window.__debugModeValue = value;
	}
});

export function debugEnabled() {
	if (typeof window !== 'undefined' && typeof window.__debugModeValue === 'boolean') {
		return window.__debugModeValue;
	}

	return get(debugMode);
}

export const isStreaming = derived(
	[connected, sensorData],
	([$connected, $sensorData]) => $connected && Object.keys($sensorData).length > 0
);

export function updateSensorData(newData) {
	if (!newData) return;

	try {
		updateCount.update((count) => count + 1);

		if (newData.sequence && newData.sequence % 50 === 0) {
			console.log(`Motion store updating with sequence ${newData.sequence}`);

			const sensorCount = Object.keys(newData).filter((key) => key.startsWith('S')).length;

			mappingStats.update((stats) => ({
				...stats,
				totalSensors: sensorCount,
				lastUpdate: Date.now()
			}));
		}

		sensorData.set({ ...newData });
	} catch (error) {
		console.error('Error updating sensor data in store:', error);
	}
}

export function setConnected(status) {
	connected.set(status);

	if (!status) {
		sensorData.set({});
		updateCount.set(0);
	}
}

export function selectModel(modelId) {
	console.log(`Setting model to: ${modelId}`);
	selectedModel.set(modelId);
}

export function selectEnvironment(envId) {
	console.log(`Setting environment to: ${envId}`);
	selectedEnvironment.set(envId);
}

export function toggleSkeleton() {
	showSkeleton.update((current) => {
		const newValue = !current;
		console.log(`Skeleton visibility ${newValue ? 'enabled' : 'disabled'}`);
		return newValue;
	});
}

export function setLoading(isLoading) {
	loading.set(isLoading);
}

export function toggleDebug() {
	debugMode.update((current) => {
		const newValue = !current;
		console.log(`Debug mode ${newValue ? 'enabled' : 'disabled'}`);
		window.__debugModeValue = newValue;
		return newValue;
	});
}

export function logDebug(message, data) {
	// Get the current debug mode value
	const isDebug = debugEnabled();

	if (isDebug) {
		if (data) {
			console.log(`[DEBUG] ${message}`, data);
		} else {
			console.log(`[DEBUG] ${message}`);
		}
	}
}

export function setDataRate(rate) {
	dataRate.set(rate);
}

export function updateMappingStats(stats) {
	mappingStats.update((current) => ({
		...current,
		...stats,
		lastUpdate: Date.now()
	}));
}

export function setCalibrationStatus(status) {
	calibrationStatus.update((current) => ({
		...current,
		isCalibrated: status,
		tPoseTimestamp: status ? new Date() : current.tPoseTimestamp
	}));
}

export function updateBodyProportions(proportions) {
	bodyProportions.update((current) => ({
		...current,
		...proportions
	}));
}

export function startRecording() {
	isRecording.set(true);
	recordedAnimations.update((current) => {
		const newRecording = {
			id: Date.now(),
			name: `Recording ${current.length + 1}`,
			frames: [],
			startTime: Date.now()
		};
		return [...current, newRecording];
	});
}

export function stopRecording() {
	isRecording.set(false);

	recordedAnimations.update((recordings) => {
		if (recordings.length === 0) return recordings;

		const lastIndex = recordings.length - 1;
		const lastRecording = recordings[lastIndex];

		if (lastRecording.frames.length === 0) {
			return recordings.slice(0, -1);
		}

		const updatedRecording = {
			...lastRecording,
			endTime: Date.now(),
			duration: Date.now() - lastRecording.startTime,
			frameCount: lastRecording.frames.length
		};

		return [...recordings.slice(0, -1), updatedRecording];
	});
}

export function addRecordingFrame(sensorData) {
	const recording = get(isRecording);
	if (!recording) return;

	recordedAnimations.update((recordings) => {
		if (recordings.length === 0) return recordings;

		const lastIndex = recordings.length - 1;
		const lastRecording = recordings[lastIndex];

		const newFrame = {
			timestamp: Date.now(),
			relativeTime: Date.now() - lastRecording.startTime,
			data: JSON.parse(JSON.stringify(sensorData))
		};

		const updatedRecording = {
			...lastRecording,
			frames: [...lastRecording.frames, newFrame]
		};

		return [...recordings.slice(0, -1), updatedRecording];
	});
}

export function playRecording(recordingId) {
	const recordings = get(recordedAnimations);
	const recording = recordings.find((r) => r.id === recordingId);

	if (!recording) return;

	currentPlayback.set(recording);
	playbackProgress.set(0);
}

export function stopPlayback() {
	currentPlayback.set(null);
	playbackProgress.set(0);
}

export const dataRateStatus = derived(dataRate, ($dataRate) => {
	if ($dataRate < 10) return 'low';
	if ($dataRate < 25) return 'medium';
	return 'good';
});
