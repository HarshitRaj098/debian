import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ProcessExecutionOptions {
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  shell?: boolean;
  encoding?: string;
}

export interface ProcessExecutionResult {
  executable: string;
  arguments: string[];
  cwd: string;
  environmentSummary: {
    PATH: string;
    HOME: string;
    USER: string;
    SHELL: string;
  };
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  error?: string;
}

export type ProcessErrorClassification =
  | 'EXECUTABLE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'SPAWN_FAILED'
  | 'TIMEOUT'
  | 'SIGNAL_TERMINATED'
  | 'INVALID_WORKING_DIRECTORY'
  | 'ENVIRONMENT_FAILURE'
  | 'SUCCESS';

export class ProcessExecutor {
  public static async resolveExecutable(executable: string): Promise<string | null> {
    if (path.isAbsolute(executable) && fs.existsSync(executable)) {
      return executable;
    }

    const searchPaths = [
      '/usr/bin/' + executable,
      '/usr/local/bin/' + executable,
      '/bin/' + executable,
      '/sbin/' + executable,
      '/usr/sbin/' + executable
    ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    const pathEnv = process.env.PATH || '';
    const dirs = pathEnv.split(path.delimiter);
    for (const dir of dirs) {
      const candidate = path.join(dir, executable);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  public static async execute(options: ProcessExecutionOptions): Promise<ProcessExecutionResult> {
    const startTime = Date.now();
    const resolvedCwd = options.cwd && fs.existsSync(options.cwd) ? options.cwd : process.cwd();
    const timeoutMs = options.timeoutMs || 30000;

    const resolvedExec = await this.resolveExecutable(options.executable);
    if (!resolvedExec) {
      const endTime = Date.now();
      return {
        executable: options.executable,
        arguments: options.args,
        cwd: resolvedCwd,
        environmentSummary: {
          PATH: process.env.PATH || '',
          HOME: process.env.HOME || '',
          USER: os.userInfo().username || 'root',
          SHELL: process.env.SHELL || '/bin/sh'
        },
        exitCode: 127,
        stdout: '',
        stderr: `EXECUTABLE_NOT_FOUND: Could not resolve executable "${options.executable}" in PATH or standard system paths.`,
        signal: null,
        timedOut: false,
        durationMs: endTime - startTime,
        error: 'EXECUTABLE_NOT_FOUND'
      };
    }

    const customEnv = {
      ...process.env,
      HOME: process.env.HOME || '/home/ubuntu',
      PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      USER: os.userInfo().username || 'root',
      ...(options.env || {})
    };

    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      let stderrData = '';
      let timedOut = false;
      let finished = false;

      let child: ChildProcess;
      try {
        child = spawn(resolvedExec, options.args, {
          cwd: resolvedCwd,
          env: customEnv,
          shell: options.shell || false
        });
      } catch (e: any) {
        const endTime = Date.now();
        return resolve({
          executable: resolvedExec,
          arguments: options.args,
          cwd: resolvedCwd,
          environmentSummary: {
            PATH: customEnv.PATH || '',
            HOME: customEnv.HOME || '',
            USER: customEnv.USER || '',
            SHELL: process.env.SHELL || '/bin/sh'
          },
          exitCode: 1,
          stdout: '',
          stderr: `SPAWN_FAILED: ${e.message}`,
          signal: null,
          timedOut: false,
          durationMs: endTime - startTime,
          error: 'SPAWN_FAILED'
        });
      }

      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (chunk) => {
          stderrData += chunk.toString();
        });
      }

      const timer = setTimeout(() => {
        if (!finished) {
          timedOut = true;
          finished = true;
          try {
            child.kill('SIGKILL');
          } catch {}
          const endTime = Date.now();
          const fullBuffer = Buffer.concat(stdoutChunks);
          const stdoutStr = fullBuffer.toString(options.encoding === 'buffer' ? 'latin1' : 'utf8');
          resolve({
            executable: resolvedExec,
            arguments: options.args,
            cwd: resolvedCwd,
            environmentSummary: {
              PATH: customEnv.PATH || '',
              HOME: customEnv.HOME || '',
              USER: customEnv.USER || '',
              SHELL: process.env.SHELL || '/bin/sh'
            },
            exitCode: -1,
            stdout: stdoutStr,
            stderr: stderrData + `\nCOMMAND_TIMEOUT: Process exceeded ${timeoutMs}ms timeout limit.`,
            signal: 'SIGKILL',
            timedOut: true,
            durationMs: endTime - startTime,
            error: 'TIMEOUT'
          });
        }
      }, timeoutMs);

      child.on('close', (code, signal) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          const endTime = Date.now();
          const fullBuffer = Buffer.concat(stdoutChunks);
          const stdoutStr = fullBuffer.toString(options.encoding === 'buffer' ? 'latin1' : 'utf8');
          resolve({
            executable: resolvedExec,
            arguments: options.args,
            cwd: resolvedCwd,
            environmentSummary: {
              PATH: customEnv.PATH || '',
              HOME: customEnv.HOME || '',
              USER: customEnv.USER || '',
              SHELL: process.env.SHELL || '/bin/sh'
            },
            exitCode: code,
            stdout: stdoutStr,
            stderr: stderrData,
            signal,
            timedOut: false,
            durationMs: endTime - startTime
          });
        }
      });

      child.on('error', (err) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          const endTime = Date.now();
          const fullBuffer = Buffer.concat(stdoutChunks);
          const stdoutStr = fullBuffer.toString(options.encoding === 'buffer' ? 'latin1' : 'utf8');
          resolve({
            executable: resolvedExec,
            arguments: options.args,
            cwd: resolvedCwd,
            environmentSummary: {
              PATH: customEnv.PATH || '',
              HOME: customEnv.HOME || '',
              USER: customEnv.USER || '',
              SHELL: process.env.SHELL || '/bin/sh'
            },
            exitCode: 1,
            stdout: stdoutStr,
            stderr: stderrData + `\nERROR: ${err.message}`,
            signal: null,
            timedOut: false,
            durationMs: endTime - startTime,
            error: 'SPAWN_FAILED'
          });
        }
      });
    });
  }
}
