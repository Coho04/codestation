import { spawn, type IPty } from 'node-pty';
import type { PtyHandle, PtyPort, SpawnOptions } from './pty-port.js';

export class NodePtyAdapter implements PtyPort {
  spawn(options: SpawnOptions): PtyHandle {
    const pty: IPty = spawn(options.file, [...options.args], {
      name: 'xterm-256color',
      cwd: options.cwd,
      env: { ...options.env },
      cols: options.cols,
      rows: options.rows,
      // Flow control is handled above this layer, on real render acknowledgements
      // from xterm rather than on node-pty's byte counting.
      handleFlowControl: false,
    });

    return {
      pid: pty.pid,
      write: (data) => pty.write(data),
      resize: (cols, rows) => {
        if (cols > 0 && rows > 0) pty.resize(cols, rows);
      },
      pause: () => pty.pause(),
      resume: () => pty.resume(),
      kill: (signal) => pty.kill(signal),
      onData: (listener) => {
        pty.onData(listener);
      },
      onExit: (listener) => {
        pty.onExit(({ exitCode, signal }) => listener(exitCode, signal ?? null));
      },
    };
  }
}
