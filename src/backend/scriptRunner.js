const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Parses an argument template string into an array of CLI arguments,
 * respecting quoted tokens and substituting Hydra placeholders:
 * %FILE%     -> Full path to downloaded file
 * %DIR%      -> Containing directory
 * %NAME%     -> Basename of downloaded file
 * %URL%      -> Download URL
 * %SIZE%     -> File size in bytes
 * %CATEGORY% -> Detected category (e.g. Video, Audio, Compressed)
 * %STATUS%   -> Download status (completed)
 */
function substitutePlaceholders(argTemplate, task) {
  if (!argTemplate) return [];

  const filePath = task.savePath || '';
  const dirPath = filePath ? path.dirname(filePath) : '';
  const fileName = filePath ? path.basename(filePath) : (task.name || '');
  const url = task.url || task.directUrl || '';
  const size = String(task.totalBytes || task.downloadedBytes || 0);
  const category = task.category || '';
  const status = task.status || 'completed';

  let substituted = argTemplate
    .replace(/%FILE%/gi, filePath)
    .replace(/%DIR%/gi, dirPath)
    .replace(/%NAME%/gi, fileName)
    .replace(/%URL%/gi, url)
    .replace(/%SIZE%/gi, size)
    .replace(/%CATEGORY%/gi, category)
    .replace(/%STATUS%/gi, status);

  // Parse into token array respecting quotes
  const tokens = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match;
  while ((match = regex.exec(substituted)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1]);
    } else if (match[2] !== undefined) {
      tokens.push(match[2]);
    } else {
      tokens.push(match[0]);
    }
  }

  return tokens;
}

/**
 * Determines the script interpreter and argument structure based on configuration and file extension.
 */
function resolveScriptCommand(config, task) {
  const scriptPath = (config.postDownloadScriptPath || '').trim();
  const customCompiler = (config.postDownloadCustomCompiler || '').trim();
  const rawArgs = config.postDownloadArguments || '"%FILE%"';
  const customArgs = substitutePlaceholders(rawArgs, task);

  let type = config.postDownloadScriptType || 'auto';

  // Auto-detect based on file extension
  if (type === 'auto' && scriptPath) {
    const ext = path.extname(scriptPath).toLowerCase();
    if (ext === '.py') type = 'python';
    else if (ext === '.ps1') type = 'powershell';
    else if (ext === '.bat' || ext === '.cmd') type = 'batch';
    else if (ext === '.js' || ext === '.mjs') type = 'node';
    else type = 'custom';
  }

  let executable = '';
  let args = [];

  switch (type) {
    case 'python':
      executable = customCompiler || 'python.exe';
      args = scriptPath ? [scriptPath, ...customArgs] : [...customArgs];
      break;

    case 'powershell':
      executable = 'powershell.exe';
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
      if (scriptPath) {
        args.push('-File', scriptPath, ...customArgs);
      } else {
        args.push('-Command', ...customArgs);
      }
      break;

    case 'batch':
      executable = 'cmd.exe';
      args = ['/c'];
      if (scriptPath) {
        args.push(scriptPath, ...customArgs);
      } else {
        args.push(...customArgs);
      }
      break;

    case 'node':
      executable = customCompiler || (fs.existsSync('C:\\Program Files\\nodejs\\node.exe') ? 'C:\\Program Files\\nodejs\\node.exe' : 'node.exe');
      args = scriptPath ? [scriptPath, ...customArgs] : [...customArgs];
      break;

    case 'custom':
    default:
      if (customCompiler) {
        executable = customCompiler;
        args = scriptPath ? [scriptPath, ...customArgs] : [...customArgs];
      } else if (scriptPath) {
        executable = scriptPath;
        args = [...customArgs];
      } else {
        executable = 'cmd.exe';
        args = ['/c', ...customArgs];
      }
      break;
  }

  return { executable, args, type };
}

/**
 * Executes post-download script.
 * @param {object} task - Completed download task object.
 * @param {object} config - Application configuration.
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, code: number}>}
 */
async function executePostDownloadScript(task, config) {
  let activeScriptConfig = config;

  if (task.customScript && typeof task.customScript === 'object') {
    if (task.customScript.enabled === false) {
      return { success: false, reason: 'disabled for this specific download' };
    }
    if (task.customScript.enabled === true) {
      activeScriptConfig = {
        postDownloadScriptEnabled: true,
        postDownloadScriptType: task.customScript.type || 'auto',
        postDownloadScriptPath: task.customScript.path || '',
        postDownloadCustomCompiler: task.customScript.compiler || '',
        postDownloadArguments: task.customScript.args || '"%FILE%"',
        postDownloadRunCondition: 'all'
      };
    }
  } else if (!config.postDownloadScriptEnabled) {
    return { success: false, reason: 'disabled' };
  }

  // Filter by category condition if specified
  const condition = activeScriptConfig.postDownloadRunCondition || 'all';
  if (condition !== 'all') {
    const taskCat = (task.category || '').toLowerCase();
    if (taskCat !== condition.toLowerCase()) {
      return { success: false, reason: `category mismatch: ${taskCat} !== ${condition}` };
    }
  }

  const { executable, args, type } = resolveScriptCommand(activeScriptConfig, task);
  if (!executable) {
    return { success: false, error: 'No script or executable configured' };
  }

  let cwd = process.cwd();
  if (task.savePath) {
    try {
      const dir = path.dirname(task.savePath);
      if (fs.existsSync(dir)) {
        cwd = dir;
      }
    } catch (_) {}
  }

  const env = {
    ...process.env,
    WATERFALL_FILE_PATH: task.savePath || '',
    WATERFALL_FILE_NAME: task.savePath ? path.basename(task.savePath) : (task.name || ''),
    WATERFALL_FILE_DIR: task.savePath ? path.dirname(task.savePath) : '',
    WATERFALL_FILE_SIZE: String(task.totalBytes || task.downloadedBytes || 0),
    WATERFALL_FILE_URL: task.url || '',
    WATERFALL_CATEGORY: task.category || '',
    WATERFALL_TASK_ID: task.id || '',
    // Backwards compatibility aliases
    HYDRA_FILE_PATH: task.savePath || '',
    HYDRA_FILE_NAME: task.savePath ? path.basename(task.savePath) : (task.name || ''),
    HYDRA_FILE_DIR: task.savePath ? path.dirname(task.savePath) : '',
    HYDRA_FILE_SIZE: String(task.totalBytes || task.downloadedBytes || 0),
    HYDRA_FILE_URL: task.url || '',
    HYDRA_CATEGORY: task.category || '',
    HYDRA_TASK_ID: task.id || ''
  };

  console.log(`[Waterfall ScriptRunner] Spawning (${type}): ${executable} ${args.join(' ')}`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    try {
      const proc = spawn(executable, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false
      });

      proc.stdout.on('data', data => {
        const text = data.toString();
        stdout += text;
        console.log(`[Script stdout] ${text.trim()}`);
      });

      proc.stderr.on('data', data => {
        const text = data.toString();
        stderr += text;
        console.warn(`[Script stderr] ${text.trim()}`);
      });

      proc.on('close', code => {
        console.log(`[Waterfall ScriptRunner] Process exited with code ${code}`);
        resolve({
          success: code === 0,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });

      proc.on('error', err => {
        console.error(`[Waterfall ScriptRunner] Process spawn error:`, err);
        resolve({
          success: false,
          code: -1,
          stdout,
          stderr: err.message
        });
      });
    } catch (err) {
      resolve({
        success: false,
        code: -1,
        stdout: '',
        stderr: err.message
      });
    }
  });
}

/**
 * Test runs a configured script with simulated task parameters.
 */
async function testRunScript(config) {
  const downloadsDir = path.join(process.cwd(), 'downloads');
  const mockTask = {
    id: 'test-preview-task',
    name: 'Sample_Waterfall_Download.mp4',
    savePath: path.join(downloadsDir, 'Sample_Waterfall_Download.mp4'),
    url: 'https://example.com/videos/sample.mp4',
    category: 'Video',
    totalBytes: 52428800,
    downloadedBytes: 52428800,
    status: 'completed'
  };

  const forcedConfig = {
    ...config,
    postDownloadScriptEnabled: true,
    postDownloadRunCondition: 'all'
  };

  return await executePostDownloadScript(mockTask, forcedConfig);
}

module.exports = {
  executePostDownloadScript,
  testRunScript,
  resolveScriptCommand,
  substitutePlaceholders
};
