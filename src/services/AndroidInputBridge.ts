import { RemoteAndroidInputEvent } from '../types/android';
import { ProcessExecutor } from './ProcessExecutor';

export class AndroidInputBridge {
  constructor(private adapter: { getBaseArgs: () => string[] }) {}

  public async sendInput(event: RemoteAndroidInputEvent): Promise<void> {
    const args = [...this.adapter.getBaseArgs(), 'shell', 'input'];
    
    switch (event.type) {
      case 'tap':
        args.push('tap', String(event.x), String(event.y));
        break;
      case 'swipe':
        args.push('swipe', String(event.x), String(event.y), String(event.toX), String(event.toY), String(event.durationMs || 500));
        break;
      case 'key':
        args.push('keyevent', String(event.keyCode));
        break;
      case 'text':
        args.push('text', event.text || '');
        break;
      case 'back':
        args.push('keyevent', 'KEYCODE_BACK');
        break;
      case 'home':
        args.push('keyevent', 'KEYCODE_HOME');
        break;
      default:
        throw new Error(`Unsupported input type: ${event.type}`);
    }

    await ProcessExecutor.execute({ executable: 'adb', args, timeoutMs: 2000 });
  }
}
