import * as vscode from 'vscode';

type TaskPickItem = vscode.QuickPickItem & { task: vscode.Task };
type LaunchPickItem = vscode.QuickPickItem & { launch: LaunchSelection };

interface LaunchSelection {
	configuration: vscode.DebugConfiguration;
	folder: vscode.WorkspaceFolder | undefined;
}

let taskSelectorItem: vscode.StatusBarItem;
let taskRunnerItem: vscode.StatusBarItem;
let launchSelectorItem: vscode.StatusBarItem;
let launchRunnerItem: vscode.StatusBarItem;
let cachedTasks: vscode.Task[] = [];
let cachedLaunches: LaunchSelection[] = [];
let selectedTask: vscode.Task | undefined;
let selectedTaskKey: string | undefined;
let selectedLaunch: LaunchSelection | undefined;
let selectedLaunchKey: string | undefined;
let state: vscode.Memento;

export async function activate(context: vscode.ExtensionContext) {
	state = context.workspaceState;

	taskSelectorItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	taskSelectorItem.command = 'task-bus.selectTask';
	taskSelectorItem.tooltip = 'Select task defined in tasks.json';
	context.subscriptions.push(taskSelectorItem);

	taskRunnerItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	taskRunnerItem.command = 'task-bus.executeTask';
	context.subscriptions.push(taskRunnerItem);

	launchSelectorItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	launchSelectorItem.command = 'task-bus.selectLaunch';
	launchSelectorItem.tooltip = 'Select launch configuration defined in launch.json';
	context.subscriptions.push(launchSelectorItem);

	launchRunnerItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
	launchRunnerItem.command = 'task-bus.executeLaunch';
	context.subscriptions.push(launchRunnerItem);

	context.subscriptions.push(
		vscode.commands.registerCommand('task-bus.selectTask', selectTask),
		vscode.commands.registerCommand('task-bus.executeTask', executeTask),
		vscode.commands.registerCommand('task-bus.selectLaunch', selectLaunch),
		vscode.commands.registerCommand('task-bus.executeLaunch', executeLaunch)
	);

	const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/tasks.json');
	context.subscriptions.push(
		watcher,
		watcher.onDidChange(() => refreshTasks()),
		watcher.onDidCreate(() => refreshTasks()),
		watcher.onDidDelete(() => refreshTasks())
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => refreshTasks())
	);

	const launchWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/launch.json');
	context.subscriptions.push(
		launchWatcher,
		launchWatcher.onDidChange(() => refreshLaunchConfigurations()),
		launchWatcher.onDidCreate(() => refreshLaunchConfigurations()),
		launchWatcher.onDidDelete(() => refreshLaunchConfigurations())
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('task-bus.showTaskBus') || event.affectsConfiguration('task-bus.showLaunchBus')) {
				applyVisibilitySettings();
			}
		})
	);

	selectedTaskKey = state.get<string>('task-bus:selectedTaskKey');
	selectedLaunchKey = state.get<string>('task-bus:selectedLaunchKey');

	await refreshTasks();
	await refreshLaunchConfigurations();

	applyVisibilitySettings();
}

export function deactivate() {
	// Nothing to clean up explicitly — disposables handled through subscriptions.
}

async function refreshTasks(): Promise<void> {
	try {
		const allTasks = await vscode.tasks.fetchTasks();
		cachedTasks = allTasks.filter(isWorkspaceTask);
	} catch (error) {
		cachedTasks = [];
		console.error('[Task Bus] Failed to fetch tasks', error);
	}

	if (selectedTaskKey) {
		const matchingTask = cachedTasks.find((task) => getTaskKey(task) === selectedTaskKey);
		selectedTask = matchingTask;
		if (!matchingTask) {
			selectedTaskKey = undefined;
			await state.update('task-bus:selectedTaskKey', undefined);
		}
	}

	updateTaskStatusBar();
}

async function selectTask(): Promise<void> {
	await refreshTasks();

	if (!cachedTasks.length) {
		vscode.window.showInformationMessage('Task Bus did not find any tasks in tasks.json.');
		return;
	}

	const picks: TaskPickItem[] = cachedTasks.map((task) => ({
		label: task.name,
		description: getTaskDescription(task),
		detail: getTaskDetail(task),
		task
	}));

	const selection = await vscode.window.showQuickPick(picks, {
		placeHolder: 'Select the task you want to run with Task Bus'
	});

	if (!selection) {
		return;
	}

	selectedTask = selection.task;
	selectedTaskKey = getTaskKey(selection.task);
	await state.update('task-bus:selectedTaskKey', selectedTaskKey);

	updateTaskStatusBar();
}

async function executeTask(): Promise<void> {
	await refreshTasks();

	if (!selectedTask) {
		await selectTask();
	}

	if (!selectedTask) {
		return;
	}

	try {
		// Ensure the task reference is still current by matching its key.
		const key = getTaskKey(selectedTask);
		const freshTask = cachedTasks.find((task) => getTaskKey(task) === key) ?? selectedTask;
		await vscode.tasks.executeTask(freshTask);
	} catch (error) {
		console.error('[Task Bus] Failed to execute task', error);
		vscode.window.showErrorMessage('Task Bus could not run the selected task. Please re-select it.');
		selectedTask = undefined;
		selectedTaskKey = undefined;
		await state.update('task-bus:selectedTaskKey', undefined);
		updateTaskStatusBar();
	}
}

function updateTaskStatusBar(): void {
	if (selectedTask) {
		taskSelectorItem.text = `$(list-selection) ${selectedTask.name}`;
		taskSelectorItem.tooltip = `Selected task: ${selectedTask.name}\nClick to choose a different task`;
		taskRunnerItem.tooltip = `Run ${selectedTask.name}`;
		taskRunnerItem.text = '$(play)';
		taskRunnerItem.command = 'task-bus.executeTask';
	} else {
		taskSelectorItem.text = '$(list-selection) Select Task';
		taskSelectorItem.tooltip = 'No task selected. Click to choose one.';
		taskRunnerItem.tooltip = 'Select a task to run.';
		taskRunnerItem.text = '$(play)'; // Keep icon consistent so item does not jump.
	}
}

function isWorkspaceTask(task: vscode.Task): boolean {
	if (!task.scope) {
		return false;
	}

	if (typeof task.scope === 'number') {
		return task.scope !== vscode.TaskScope.Global;
	}

	return true;
}

function getTaskKey(task: vscode.Task): string {
	const scopeId = getScopeId(task);
	const definition = JSON.stringify(task.definition ?? {});
	return `${scopeId}::${task.source ?? ''}::${task.name}::${definition}`;
}

function getScopeId(task: vscode.Task): string {
	if (!task.scope) {
		return 'unknown';
	}

	if (typeof task.scope === 'number') {
		return task.scope === vscode.TaskScope.Global ? 'global' : 'workspace';
	}

	return task.scope.name ?? 'workspaceFolder';
}

function getTaskDescription(task: vscode.Task): string | undefined {
	if (typeof task.scope === 'number') {
		return task.scope === vscode.TaskScope.Workspace ? 'Workspace' : task.source;
	}

	return task.scope?.name ?? task.source;
}

function getTaskDetail(task: vscode.Task): string | undefined {
	const folder = getWorkspaceFolder(task);
	if (folder) {
		return folder.uri.fsPath;
	}

	return undefined;
}

function getWorkspaceFolder(task: vscode.Task): vscode.WorkspaceFolder | undefined {
	if (!task.scope) {
		return undefined;
	}

	return typeof task.scope === 'number' ? undefined : task.scope;
}

async function refreshLaunchConfigurations(): Promise<void> {
	const launches: LaunchSelection[] = [];

	const folders = vscode.workspace.workspaceFolders ?? [];
	for (const folder of folders) {
		const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
		const configurations = launchConfig.get<vscode.DebugConfiguration[]>('configurations') ?? [];
		for (const configuration of configurations) {
			if (typeof configuration?.name === 'string') {
				launches.push({ folder, configuration });
			}
		}
	}

	// Workspace/global launch configurations
	const workspaceLaunchConfig = vscode.workspace.getConfiguration('launch');
	const workspaceConfigurations = workspaceLaunchConfig.get<vscode.DebugConfiguration[]>('configurations') ?? [];
	for (const configuration of workspaceConfigurations) {
		if (typeof configuration?.name === 'string') {
			launches.push({ folder: undefined, configuration });
		}
	}

	cachedLaunches = launches;

	if (selectedLaunchKey) {
		const matching = cachedLaunches.find((launch) => getLaunchKey(launch) === selectedLaunchKey);
		selectedLaunch = matching;
		if (!matching) {
			selectedLaunchKey = undefined;
			await state.update('task-bus:selectedLaunchKey', undefined);
		}
	}

	updateLaunchStatusBar();
}

async function selectLaunch(): Promise<void> {
	await refreshLaunchConfigurations();

	if (!cachedLaunches.length) {
		vscode.window.showInformationMessage('Task Bus did not find any launch configurations in launch.json.');
		return;
	}

	const picks: LaunchPickItem[] = cachedLaunches.map((launch) => ({
		label: launch.configuration.name ?? 'Unnamed launch',
		description: getLaunchDescription(launch),
		detail: launch.folder?.uri.fsPath,
		launch
	}));

	const selection = await vscode.window.showQuickPick(picks, {
		placeHolder: 'Select the launch configuration you want to run with Task Bus'
	});

	if (!selection) {
		return;
	}

	selectedLaunch = selection.launch;
	selectedLaunchKey = getLaunchKey(selection.launch);
	await state.update('task-bus:selectedLaunchKey', selectedLaunchKey);

	updateLaunchStatusBar();
}

async function executeLaunch(): Promise<void> {
	await refreshLaunchConfigurations();

	if (!selectedLaunch) {
		await selectLaunch();
	}

	if (!selectedLaunch) {
		return;
	}

	try {
		const key = getLaunchKey(selectedLaunch);
		const freshLaunch = cachedLaunches.find((launch) => getLaunchKey(launch) === key) ?? selectedLaunch;
		await vscode.debug.startDebugging(freshLaunch.folder, freshLaunch.configuration);
	} catch (error) {
		console.error('[Task Bus] Failed to start launch configuration', error);
		vscode.window.showErrorMessage('Task Bus could not run the selected launch configuration. Please re-select it.');
		selectedLaunch = undefined;
		selectedLaunchKey = undefined;
		await state.update('task-bus:selectedLaunchKey', undefined);
		updateLaunchStatusBar();
	}
}

function updateLaunchStatusBar(): void {
	if (selectedLaunch) {
		const configName = selectedLaunch.configuration.name;
		launchSelectorItem.text = `$(debug-alt) ${configName}`;
		launchSelectorItem.tooltip = `Selected launch configuration: ${configName}\nClick to choose a different configuration`;
		launchRunnerItem.tooltip = `Start ${configName}`;
		launchRunnerItem.text = '$(rocket)';
		launchRunnerItem.command = 'task-bus.executeLaunch';
	} else {
		launchSelectorItem.text = '$(debug-alt) Select Launch';
		launchSelectorItem.tooltip = 'No launch configuration selected. Click to choose one.';
		launchRunnerItem.tooltip = 'Select a launch configuration to run.';
		launchRunnerItem.text = '$(rocket)';
	}
}

function getLaunchKey(launch: LaunchSelection): string {
	const folderUri = launch.folder?.uri.toString() ?? 'workspace';
	const { name, type, request } = launch.configuration;
	return `${folderUri}::${name ?? ''}::${type ?? ''}::${request ?? ''}`;
}

function getLaunchDescription(launch: LaunchSelection): string | undefined {
	const { type, request } = launch.configuration;
	if (type && request) {
		return `${type} (${request})`;
	}

	return type ?? request;
}

function applyVisibilitySettings(): void {
	const configuration = vscode.workspace.getConfiguration('task-bus');
	const showTaskBus = configuration.get<boolean>('showTaskBus', true);
	const showLaunchBus = configuration.get<boolean>('showLaunchBus', true);

	if (showTaskBus) {
		taskSelectorItem.show();
		taskRunnerItem.show();
	} else {
		taskSelectorItem.hide();
		taskRunnerItem.hide();
	}

	if (showLaunchBus) {
		launchSelectorItem.show();
		launchRunnerItem.show();
	} else {
		launchSelectorItem.hide();
		launchRunnerItem.hide();
	}
}
