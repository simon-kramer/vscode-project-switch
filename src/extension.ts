import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface Project {
    name: string;
    path: string;
    description?: string;
}

const PROJECTS_FILE = path.join(__dirname, 'projects.json');

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('projectSwitcher.switchProject', async () => {
            openProjectOverview();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('projectSwitcher.manageProjects', async () => {
            openManageProjectsMenu();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('projectSwitcher.openWebOverview', () => {
            openWebOverview(context);
        })
    );
}

function loadProjects(): Project[] {
    if (fs.existsSync(PROJECTS_FILE)) {
        const data = fs.readFileSync(PROJECTS_FILE, 'utf8');
        return JSON.parse(data) as Project[];
    }
    return [];
}

function saveProjects(projects: Project[]): void {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf8');
}

async function openProjectOverview() {
    let projects = loadProjects();

    const items = projects.map(project => ({
        label: project.name,
        description: project.description,
        detail: project.path,
        projectPath: project.path
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a project to open',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected && selected.projectPath) {
        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(selected.projectPath), false);
    }
}

async function openManageProjectsMenu() {
    const action = await vscode.window.showQuickPick(['Add Project', 'Edit Project', 'Remove Project'], {
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
    }
}

async function addProject() {
    const name = await vscode.window.showInputBox({ placeHolder: 'Enter project name' });
    const description = await vscode.window.showInputBox({ placeHolder: 'Enter project description' });
    const uri = await vscode.window.showOpenDialog({ canSelectFolders: true, openLabel: 'Select Project Folder' });

    if (name && uri && uri.length > 0) {
        const projects = loadProjects();
        projects.push({ name, path: uri[0].fsPath, description: description || '' });
        saveProjects(projects);
        vscode.window.showInformationMessage(`Project '${name}' added successfully!`);
    }
}

async function editProject() {
    const projects = loadProjects();
    const projectNames = projects.map((project) => project.name);
    const selectedProjectName = await vscode.window.showQuickPick(projectNames, {
        placeHolder: 'Select a project to edit'
    });

    if (selectedProjectName) {
        const project = projects.find(p => p.name === selectedProjectName);
        if (project) {
            const newName = await vscode.window.showInputBox({ placeHolder: 'Enter new project name', value: project.name });
            const newDescription = await vscode.window.showInputBox({ placeHolder: 'Enter new project description', value: project.description });

            if (newName) {
                project.name = newName;
            }
            if (newDescription) {
                project.description = newDescription;
            }

            saveProjects(projects);
            vscode.window.showInformationMessage(`Project '${selectedProjectName}' updated successfully!`);
        }
    }
}

async function deleteProject() {
    const projects = loadProjects();
    const projectNames = projects.map((project) => project.name);
    const selectedProjectName = await vscode.window.showQuickPick(projectNames, {
        placeHolder: 'Select a project to remove from the Switcher'
    });

    if (selectedProjectName) {
        const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: `Are you sure you want to delete '${selectedProjectName}'?`
        });

        if (confirm === 'Yes') {
            const updatedProjects = projects.filter(p => p.name !== selectedProjectName);
            saveProjects(updatedProjects);
            vscode.window.showInformationMessage(`Project '${selectedProjectName}' deleted from the Switcher!`);
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

    const projects = loadProjects(); 

    panel.webview.html = getWebviewContent(projects);

    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case 'addProject':
                    await addProject();
                    panel.webview.html = getWebviewContent(loadProjects()); 
                    break;
                case 'editProject':
                    await editProjectByName(message.projectName);
                    panel.webview.html = getWebviewContent(loadProjects()); 
                    break;
                case 'deleteProject':
                    await deleteProjectByName(message.projectName);
                    panel.webview.html = getWebviewContent(loadProjects());
                    break;
            }
        },
        undefined,
        context.subscriptions
    );
}

function getWebviewContent(projects: Project[]): string {
    let projectListHTML = projects.map(project => `
        <div class="project-item">
            <h2>${project.name}</h2>
            <p>${project.description}</p>
            <button class="vscode-button" onclick="editProject('${project.name}')">Edit</button>
            <button class="vscode-button" onclick="deleteProject('${project.name}')">Delete</button>
        </div>
    `).join('');

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
            }
            .project-container {
                display: flex;
                flex-wrap: wrap;
                gap: 16px; /* Add space between cards */
                margin-top: 20px; /* Margin top to separate from the button */
            }
            .project-item {
                width: calc(50% - 8px); /* Two cards per row with gap accounted for */
                box-sizing: border-box; /* Ensure padding and border are included in width */
                margin-bottom: 15px;
                padding: 10px;
                border: 1px solid var(--vscode-editorWidget-border);
                border-radius: 5px;
                background-color: var(--vscode-editorWidget-background);
            }
            .project-item h2 {
                margin: 0 0 5px;
            }
            .vscode-button {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 5px 10px;
                margin-right: 5px;
                border-radius: 3px;
                cursor: pointer;
            }
            .vscode-button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            .add-project-button {
                margin-bottom: 20px; /* Add margin to separate from the cards below */
            }
        </style>
    </head>
    <body>
        <h1>Project Switcher: Overview</h1>
        <button class="vscode-button add-project-button" onclick="addProject()">Add New Project</button>
        <div class="project-container">
            ${projectListHTML}
        </div>
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
        </script>
    </body>
    </html>
    `;
}



async function editProjectByName(projectName: string) {
    const projects = loadProjects();
    const project = projects.find(p => p.name === projectName);
    if (project) {
        const newName = await vscode.window.showInputBox({ placeHolder: 'Enter new project name', value: project.name });
        const newDescription = await vscode.window.showInputBox({ placeHolder: 'Enter new project description', value: project.description });

        if (newName) {
            project.name = newName;
        }
        if (newDescription) {
            project.description = newDescription;
        }

        saveProjects(projects);
        vscode.window.showInformationMessage(`Project '${projectName}' updated successfully!`);
    }
}

async function deleteProjectByName(projectName: string) {
    const projects = loadProjects();
    const updatedProjects = projects.filter(p => p.name !== projectName);
    saveProjects(updatedProjects);
    vscode.window.showInformationMessage(`Project '${projectName}' deleted successfully!`);
}

export function deactivate() {}
