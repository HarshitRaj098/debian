import fs from 'fs';
import path from 'path';
import { RawApkInput, NormalizedApkArtifact, InstallTransaction, AndroidPackageService } from './AndroidPackageService';
import { androidPackageService } from './AndroidPackageService';

export class UniversalAndroidInstaller {
  private packageService: AndroidPackageService;

  constructor(packageService: AndroidPackageService) {
    this.packageService = packageService;
  }

  public async installLocalFile(filePath: string): Promise<InstallTransaction> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const input: RawApkInput = {
      sourceType: 'LOCAL_FILE',
      filePath: filePath
    };

    return await this.packageService.installApk(input, { autoLaunch: true });
  }

  public async handleBrowserDownload(filePath: string): Promise<InstallTransaction> {
      // Logic to hook into BrowserDownloadManager could be added here
      return await this.installLocalFile(filePath);
  }
}

export const universalAndroidInstaller = new UniversalAndroidInstaller(androidPackageService);
