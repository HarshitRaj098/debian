import fs from 'fs';
import { execSync } from 'child_process';

export class Sentinel {
  private hashFile = './KNOWN_GOOD_STATE.sha256';

  public verifyInvariants(): { passed: boolean; details: string[] } {
    console.log("Sentinel: Verifying system invariants...");
    const details: string[] = [];
    let passed = true;

    // 1. Integrity check
    try {
      execSync(`sha256sum -c ${this.hashFile}`);
      details.push("Integrity: All critical files match Known Good State.");
    } catch (e) {
      details.push("Integrity: CRITICAL - Hash mismatch detected!");
      passed = false;
    }

    // 2. Runtime reality check
    if (!fs.existsSync('/home/ubuntu')) {
      details.push("Runtime: CRITICAL - Persistent storage missing.");
      passed = false;
    } else {
      details.push("Runtime: Persistent storage verified.");
    }

    return { passed, details };
  }
}
