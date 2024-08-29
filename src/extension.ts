import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface Project {
    name: string;
    path: string;
    description?: string;
    groupId: string;
    persistTerminal: boolean;
}

interface Group {
    id: string;
    name: string;
}

interface ProjectData {
    projects: Project[];
    groups: Group[];
}

const DATA_FILE = path.join(__dirname, 'project_data.json');

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('projectSwitch');

    const switchProjectKeybinding = config.get<string>('switchProjectKeybinding', 'ctrl+shift+u');
    const manageProjectsKeybinding = config.get<string>('manageProjectsKeybinding', 'ctrl+shift+i');
    const openWebOverviewKeybinding = config.get<string>('openWebOverviewKeybinding', 'ctrl+shift+w');

    context.subscriptions.push(
        vscode.commands.registerCommand('projectSwitch.switchProject', async () => {
            openProjectOverview();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('projectSwitch.manageProjects', async () => {
            openManageProjectsMenu();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('projectSwitch.openWebOverview', () => {
            openWebOverview(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('projectSwitch.switchProjectWithKeybinding', () => {
            vscode.commands.executeCommand('projectSwitch.switchProject');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('projectSwitch.manageProjectsWithKeybinding', () => {
            vscode.commands.executeCommand('projectSwitch.manageProjects');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('projectSwitch.openWebOverviewWithKeybinding', () => {
            vscode.commands.executeCommand('projectSwitch.openWebOverview');
        })
    );

    vscode.commands.executeCommand('setContext', 'projectSwitch.switchProjectKeybinding', switchProjectKeybinding);
    vscode.commands.executeCommand('setContext', 'projectSwitch.manageProjectsKeybinding', manageProjectsKeybinding);
    vscode.commands.executeCommand('setContext', 'projectSwitch.openWebOverviewKeybinding', openWebOverviewKeybinding);
}

function loadData(): ProjectData {
    if (fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data) as ProjectData;
    }
    return { projects: [], groups: [] };
}

function saveData(data: ProjectData): void {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function openProjectOverview() {
    const data = loadData();
    const groupedProjects = groupProjectsByGroup(data.projects, data.groups);

    const items = data.groups.flatMap(group => {
        const groupProjects = groupedProjects[group.id] || [];
        return [
            { label: group.name, kind: vscode.QuickPickItemKind.Separator },
            ...groupProjects.map(project => ({
                label: project.name,
                description: project.description,
                detail: project.path,
                projectPath: project.path,
                persistTerminal: project.persistTerminal
            }))
        ];
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a project to open',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected && 'projectPath' in selected) {
        if (selected.persistTerminal) {
            await saveTerminalState();
        }

        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(selected.projectPath), false);

        if (selected.persistTerminal) {
            await restoreTerminalState(selected.projectPath);
        }
    }
}

async function saveTerminalState() {
    const terminals = vscode.window.terminals;
    const terminalState = terminals.map(terminal => {
        const state: any = {
            name: terminal.name
        };

        if ('cwd' in terminal.creationOptions) {
            state.cwd = terminal.creationOptions.cwd;
        }
        if ('shellPath' in terminal.creationOptions) {
            state.shellPath = terminal.creationOptions.shellPath;
        }
        if ('shellArgs' in terminal.creationOptions) {
            state.shellArgs = terminal.creationOptions.shellArgs;
        }

        return state;
    });

    await vscode.workspace.getConfiguration('projectSwitch').update('lastTerminalState', terminalState, vscode.ConfigurationTarget.Global);
}

async function restoreTerminalState(projectPath: string) {
    const terminalState = vscode.workspace.getConfiguration('projectSwitch').get('lastTerminalState') as any[];
    if (terminalState) {
        for (const terminalInfo of terminalState) {
            const options: vscode.TerminalOptions = {
                name: terminalInfo.name,
                cwd: projectPath
            };

            if (terminalInfo.shellPath) {
                options.shellPath = terminalInfo.shellPath;
            }
            if (terminalInfo.shellArgs) {
                options.shellArgs = terminalInfo.shellArgs;
            }

            const terminal = vscode.window.createTerminal(options);
            terminal.show();
        }
    }
}

function groupProjectsByGroup(projects: Project[], groups: Group[]): { [groupId: string]: Project[] } {
    const groupedProjects: { [groupId: string]: Project[] } = {};
    groups.forEach(group => {
        groupedProjects[group.id] = projects.filter(project => project.groupId === group.id);
    });
    return groupedProjects;
}

async function openManageProjectsMenu() {
    const action = await vscode.window.showQuickPick([
        'Add Project',
        'Edit Project',
        'Remove Project',
        'Add Group',
        'Edit Group',
        'Remove Group'
    ], {
        placeHolder: 'What do you want to do?'
    });

    switch (action) {
        case 'Add Project':
            await addProject();
            break;
        case 'Edit Project':
            await editProject();
            break;
        case 'Remove Project':
            await deleteProject();
            break;
        case 'Add Group':
            await addGroup();
            break;
        case 'Edit Group':
            await editGroup();
            break;
        case 'Remove Group':
            await deleteGroup();
            break;
    }
}

async function addProject() {
    const data = loadData();
    const name = await vscode.window.showInputBox({ 
        placeHolder: 'Enter project name',
        ignoreFocusOut: true
    });
    if (!name) {return;}

    const description = await vscode.window.showInputBox({ 
        placeHolder: 'Enter project description',
        ignoreFocusOut: true
    });
    if (description === undefined) {return;}

    const uri = await vscode.window.showOpenDialog({ 
        canSelectFolders: true, 
        openLabel: 'Select Project Folder'
    });
    if (!uri || uri.length === 0) {return;}

    let groupId: string | undefined;

    if (data.groups.length === 0) {
        const defaultGroupId = Date.now().toString();
        data.groups.push({ id: defaultGroupId, name: 'Default Group' });
        groupId = defaultGroupId;
        vscode.window.showInformationMessage('Created a default group as no groups existed.');
    } else {
        groupId = await selectGroup(data.groups);
    }

    if (!groupId) {return;}

    const persistTerminal = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Persist the terminals content when switching projects?',
        ignoreFocusOut: true
    });

    data.projects.push({ 
        name, 
        path: uri[0].fsPath, 
        description: description || '',
        groupId,
        persistTerminal: persistTerminal === 'Yes'
    });
    saveData(data);
    vscode.window.showInformationMessage(`Project '${name}' added successfully!`);
}

async function selectGroup(groups: Group[]): Promise<string | undefined> {
    if (groups.length === 1) {
        return groups[0].id;
    }

    const groupItems = groups.map(group => ({
        label: group.name,
        id: group.id
    }));

    const selectedGroup = await vscode.window.showQuickPick(groupItems, {
        placeHolder: 'Select a group for the project',
        ignoreFocusOut: true
    });

    return selectedGroup?.id;
}

async function editProject() {
    const data = loadData();
    const projectNames = data.projects.map((project) => project.name);
    const selectedProjectName = await vscode.window.showQuickPick(projectNames, {
        placeHolder: 'Select a project to edit',
        ignoreFocusOut: true
    });

    if (selectedProjectName) {
        const project = data.projects.find(p => p.name === selectedProjectName);
        if (project) {
            const newName = await vscode.window.showInputBox({ 
                placeHolder: 'Enter new project name', 
                value: project.name,
                ignoreFocusOut: true
            });
            if (newName === undefined) {return;}

            const newDescription = await vscode.window.showInputBox({ 
                placeHolder: 'Enter new project description', 
                value: project.description,
                ignoreFocusOut: true
            });
            if (newDescription === undefined) {return;}

            const newGroupId = await selectGroup(data.groups);
            if (!newGroupId) {return;}

            const persistTerminal = await vscode.window.showQuickPick(['Yes', 'No'], {
                placeHolder: 'Persist the terminals content when switching projects?',
                ignoreFocusOut: true
            });

            project.name = newName || project.name;
            project.description = newDescription || project.description;
            project.groupId = newGroupId;
            project.persistTerminal = persistTerminal === 'Yes';

            saveData(data);
            vscode.window.showInformationMessage(`Project '${selectedProjectName}' updated successfully!`);
        }
    }
}

async function deleteProject() {
    const data = loadData();
    const projectNames = data.projects.map((project) => project.name);
    const selectedProjectName = await vscode.window.showQuickPick(projectNames, {
        placeHolder: 'Select a project to remove from the Switch',
        ignoreFocusOut: true
    });

    if (selectedProjectName) {
        const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: `Are you sure you want to delete '${selectedProjectName}'?`,
            ignoreFocusOut: true
        });

        if (confirm === 'Yes') {
            data.projects = data.projects.filter(p => p.name !== selectedProjectName);
            saveData(data);
            vscode.window.showInformationMessage(`Project '${selectedProjectName}' deleted from the Switch!`);
        }
    }
}

async function addGroup() {
    const data = loadData();
    const name = await vscode.window.showInputBox({ 
        placeHolder: 'Enter group name',
        ignoreFocusOut: true
    });
    if (!name) {return;}

    const id = Date.now().toString();
    data.groups.push({ id, name });
    saveData(data);
    vscode.window.showInformationMessage(`Group '${name}' added successfully!`);
}

async function editGroup() {
    const data = loadData();
    const groupNames = data.groups.map((group) => group.name);
    const selectedGroupName = await vscode.window.showQuickPick(groupNames, {
        placeHolder: 'Select a group to edit',
        ignoreFocusOut: true
    });

    if (selectedGroupName) {
        const group = data.groups.find(g => g.name === selectedGroupName);
        if (group) {
            const newName = await vscode.window.showInputBox({ 
                placeHolder: 'Enter new group name', 
                value: group.name,
                ignoreFocusOut: true
            });
            if (newName === undefined) {return;}

            group.name = newName || group.name;
            saveData(data);
            vscode.window.showInformationMessage(`Group '${selectedGroupName}' updated successfully!`);
        }
    }
}

async function deleteGroup() {
    const data = loadData();
    const groupNames = data.groups.map((group) => group.name);
    const selectedGroupName = await vscode.window.showQuickPick(groupNames, {
        placeHolder: 'Select a group to remove',
        ignoreFocusOut: true
    });

    if (selectedGroupName) {
        const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: `Are you sure you want to delete '${selectedGroupName}'? Projects in this group will not be deleted.`,
            ignoreFocusOut: true
        });

        if (confirm === 'Yes') {
            const groupToDelete = data.groups.find(g => g.name === selectedGroupName);
            if (groupToDelete) {
                data.groups = data.groups.filter(g => g.name !== selectedGroupName);
                data.projects = data.projects.map(p => {
                    if (p.groupId === groupToDelete.id) {
                        return { ...p, groupId: 'default' };
                    }
                    return p;
                });
                saveData(data);
                vscode.window.showInformationMessage(`Group '${selectedGroupName}' deleted successfully!`);
            }
        }
    }
}

function openWebOverview(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'projectOverview', 
        'Project Switcher: Overview', 
        vscode.ViewColumn.One, 
        {
            enableScripts: true 
        }
    );

    const data = loadData();
    panel.webview.html = getWebviewContent(data, context);

    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case 'addProject':
                    await addProject();
                    panel.webview.html = getWebviewContent(loadData(), context);
                    break;
                case 'editProject':
                    await editProjectByName(message.projectName);
                    panel.webview.html = getWebviewContent(loadData(), context);
                    break;
                case 'deleteProject':
                    await deleteProjectByName(message.projectName);
                    panel.webview.html = getWebviewContent(loadData(), context);
                    break;
                case 'addGroup':
                    await addGroup();
                    panel.webview.html = getWebviewContent(loadData(), context);
                    break;
                case 'editGroup':
                    await editGroupByName(message.groupName);
                    panel.webview.html = getWebviewContent(loadData(), context);
                    break;
                    case 'deleteGroup':
                        await deleteGroupByName(message.groupName);
                        panel.webview.html = getWebviewContent(loadData(), context);
                        break;
                    case 'saveHotkeys':
                        await saveHotkeys(message.switchProjectHotkey, message.manageProjectsHotkey, message.openWebOverviewHotkey);
                        panel.webview.html = getWebviewContent(loadData(), context);
                        break;
                    case 'updatePersistTerminal':
                        await updatePersistTerminal(message.projectName, message.persistTerminal);
                        panel.webview.html = getWebviewContent(loadData(), context);
                        break;
                }
            },
            undefined,
            context.subscriptions
        );
    }
    
    async function saveHotkeys(switchProjectHotkey: string, manageProjectsHotkey: string, openWebOverviewHotkey: string) {
        const config = vscode.workspace.getConfiguration('projectSwitch');
        await config.update('switchProjectKeybinding', switchProjectHotkey, vscode.ConfigurationTarget.Global);
        await config.update('manageProjectsKeybinding', manageProjectsHotkey, vscode.ConfigurationTarget.Global);
        await config.update('openWebOverviewKeybinding', openWebOverviewHotkey, vscode.ConfigurationTarget.Global);
    
        vscode.commands.executeCommand('setContext', 'projectSwitch.switchProjectKeybinding', switchProjectHotkey);
        vscode.commands.executeCommand('setContext', 'projectSwitch.manageProjectsKeybinding', manageProjectsHotkey);
        vscode.commands.executeCommand('setContext', 'projectSwitch.openWebOverviewKeybinding', openWebOverviewHotkey);
    
        vscode.window.showInformationMessage('Hotkeys updated successfully. Please reload the window for changes to take effect.');
    }
    
    function getWebviewContent(data: ProjectData, context: vscode.ExtensionContext): string {
        const groupedProjects = groupProjectsByGroup(data.projects, data.groups);
        const config = vscode.workspace.getConfiguration('projectSwitch');
    
        let groupsHTML = data.groups.map(group => {
            const projectsInGroup = groupedProjects[group.id] || [];
            const projectsHTML = projectsInGroup.map(project => `
                <div class="project-item">
                    <div class="project-content">
                        <h3>${project.name}</h3>
                        <p>${project.description}</p>
                    </div>
                    <div class="project-footer">
                        <label class="persist-label">
                            <input type="checkbox" ${project.persistTerminal ? 'checked' : ''} onchange="updatePersistTerminal('${project.name}', this.checked)">
                            Persist terminals content<br /> (not the running process)
                        </label>
                        <div class="project-buttons">
                            <button class="vscode-button" onclick="editProject('${project.name}')">Edit</button>
                            <button class="vscode-button" onclick="deleteProject('${project.name}')">Delete</button>
                        </div>
                    </div>
                </div>
            `).join('');
    
            return `
                <div class="group-item">
                    <div class="group-header">
                        <h2>${group.name}</h2>
                        <div class="group-buttons">
                            <button class="vscode-button" onclick="editGroup('${group.name}')">Edit Group</button>
                            <button class="vscode-button" onclick="deleteGroup('${group.name}')">Delete Group</button>
                        </div>
                    </div>
                    <div class="projects-container">
                        ${projectsHTML}
                    </div>
                </div>
            `;
        }).join('');
    
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <style>
                body {
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    font-weight: var(--vscode-font-weight);
                    padding: 20px;
                }
                .group-item {
                    margin-bottom: 20px;
                    padding: 10px;
                    border: 1px solid var(--vscode-editorWidget-border);
                    border-radius: 5px;
                    background-color: var(--vscode-editorWidget-background);
                }
                .group-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .group-buttons {
                    display: flex;
                    gap: 5px;
                }
                .projects-container {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 15px;
                }
                .project-item {
                    flex: 0 0 calc(33.333% - 10px);
                    display: flex;
                    flex-direction: column;
                    margin-bottom: 15px;
                    padding: 10px;
                    border: 1px solid var(--vscode-editorWidget-border);
                    border-radius: 5px;
                    box-sizing: border-box;
                }
                .project-content {
                    flex-grow: 1;
                }
                .project-footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-top: 10px;
                }
                .persist-label {
                    display: flex;
                    align-items: center;
                    font-size: 0.9em;
                    white-space: nowrap;
                }
                .persist-label input {
                    margin-right: 5px;
                }
                .project-buttons {
                    display: flex;
                    gap: 5px;
                }
                .vscode-button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 5px 10px;
                    border-radius: 3px;
                    cursor: pointer;
                }
                .vscode-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .add-buttons {
                    margin-bottom: 20px;
                }
                .hotkey-settings {
                    margin-bottom: 40px;
                    padding: 20px;
                    background-color: var(--vscode-editorWidget-background);
                    border: 1px solid var(--vscode-editorWidget-border);
                    border-radius: 5px;
                }
                .hotkey-settings h2 {
                    margin-top: 0;
                    margin-bottom: 20px;
                }
                .hotkey-input {
                    display: flex;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .hotkey-input label {
                    flex: 0 0 150px;
                    margin-right: 10px;
                }
                .hotkey-input input {
                    flex: 1;
                    padding: 5px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 3px;
                }
                .save-hotkeys-button {
                    margin-top: 15px;
                }
                @media (max-width: 1200px) {
                    .project-item {
                        flex: 0 0 calc(50% - 7.5px);
                    }
                }
                @media (max-width: 800px) {
                    .project-item {
                        flex: 0 0 100%;
                    }
                }
            </style>
        </head>
        <body>
        <h1>Project Switch: Overview</h1>
        <div class="hotkey-settings">
            <h2>Hotkey Settings</h2>
            <div class="hotkey-input">
                <label for="switchProjectHotkey">Switch Project:</label>
                <input type="text" id="switchProjectHotkey" value="${config.get('switchProjectKeybinding', 'ctrl+shift+u')}">
            </div>
            <div class="hotkey-input">
                <label for="manageProjectsHotkey">Manage Projects:</label>
                <input type="text" id="manageProjectsHotkey" value="${config.get('manageProjectsKeybinding', 'ctrl+shift+i')}">
            </div>
            <div class="hotkey-input">
                <label for="openWebOverviewHotkey">Open Web Overview:</label>
                <input type="text" id="openWebOverviewHotkey" value="${config.get('openWebOverviewKeybinding', 'ctrl+shift+w')}">
            </div>
            <div class="save-hotkeys-button">
                <button class="vscode-button" onclick="saveHotkeys()">Save Hotkeys</button>
            </div>
        </div>
        <div class="add-buttons">
            <button class="vscode-button" onclick="addProject()">Add New Project</button>
            <button class="vscode-button" onclick="addGroup()">Add New Group</button>
        </div>
        ${groupsHTML}
        <script>
            <script>
                const vscode = acquireVsCodeApi();
    
                function addProject() {
                    vscode.postMessage({
                        command: 'addProject'
                    });
                }
    
                function editProject(projectName) {
                    vscode.postMessage({
                        command: 'editProject',
                        projectName: projectName
                    });
                }
    
                function deleteProject(projectName) {
                    vscode.postMessage({
                        command: 'deleteProject',
                        projectName: projectName
                    });
                }
    
                function addGroup() {
                    vscode.postMessage({
                        command: 'addGroup'
                    });
                }
    
                function editGroup(groupName) {
                    vscode.postMessage({
                        command: 'editGroup',
                        groupName: groupName
                    });
                }
    
                function deleteGroup(groupName) {
                    vscode.postMessage({
                        command: 'deleteGroup',
                        groupName: groupName
                    });
                }
    
                function saveHotkeys() {
                    const switchProjectHotkey = document.getElementById('switchProjectHotkey').value;
                    const manageProjectsHotkey = document.getElementById('manageProjectsHotkey').value;
                    const openWebOverviewHotkey = document.getElementById('openWebOverviewHotkey').value;
    
                    vscode.postMessage({
                        command: 'saveHotkeys',
                        switchProjectHotkey,
                        manageProjectsHotkey,
                        openWebOverviewHotkey
                    });
                }
    
                function updatePersistTerminal(projectName, persistTerminal) {
                    vscode.postMessage({
                        command: 'updatePersistTerminal',
                        projectName: projectName,
                        persistTerminal: persistTerminal
                    });
                }
            </script>
        </body>
        </html>
        `;
    }
    
    async function editProjectByName(projectName: string) {
        const data = loadData();
        const project = data.projects.find(p => p.name === projectName);
        if (project) {
            const newName = await vscode.window.showInputBox({ 
                placeHolder: 'Enter new project name', 
                value: project.name,
                ignoreFocusOut: true
            });
            if (newName === undefined) {return;}
    
            const newDescription = await vscode.window.showInputBox({ 
                placeHolder: 'Enter new project description', 
                value: project.description,
                ignoreFocusOut: true
            });
            if (newDescription === undefined) {return;}
    
            const newGroupId = await selectGroup(data.groups);
            if (!newGroupId) {return;}
    
            project.name = newName || project.name;
            project.description = newDescription || project.description;
            project.groupId = newGroupId;
    
            saveData(data);
            vscode.window.showInformationMessage(`Project '${projectName}' updated successfully!`);
        }
    }
    
    async function deleteProjectByName(projectName: string) {
        const data = loadData();
        data.projects = data.projects.filter(p => p.name !== projectName);
        saveData(data);
        vscode.window.showInformationMessage(`Project '${projectName}' deleted successfully!`);
    }
    
    async function editGroupByName(groupName: string) {
        const data = loadData();
        const group = data.groups.find(g => g.name === groupName);
        if (group) {
            const newName = await vscode.window.showInputBox({ 
                placeHolder: 'Enter new group name', 
                value: group.name,
                ignoreFocusOut: true
            });
            if (newName === undefined) {return;}
    
            group.name = newName || group.name;
            saveData(data);
            vscode.window.showInformationMessage(`Group '${groupName}' updated successfully!`);
        }
    }
    
    async function deleteGroupByName(groupName: string) {
        const data = loadData();
        const groupToDelete = data.groups.find(g => g.name === groupName);
        if (groupToDelete) {
            data.groups = data.groups.filter(g => g.name !== groupName);
            data.projects = data.projects.map(p => {
                if (p.groupId === groupToDelete.id) {
                    return { ...p, groupId: 'default' };
                }
                return p;
            });
            saveData(data);
            vscode.window.showInformationMessage(`Group '${groupName}' deleted successfully!`);
        }
    }
    
    async function updatePersistTerminal(projectName: string, persistTerminal: boolean) {
        const data = loadData();
        const project = data.projects.find(p => p.name === projectName);
        if (project) {
            project.persistTerminal = persistTerminal;
            saveData(data);
            vscode.window.showInformationMessage(`Terminal persistence ${persistTerminal ? 'enabled' : 'disabled'} for project '${projectName}'.`);
        }
    }
    
    export function deactivate() {}