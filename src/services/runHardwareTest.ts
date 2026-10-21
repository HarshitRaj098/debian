import { androidResourceService } from './AndroidResourceService';

async function run() {
  const result = await androidResourceService.runHardwareTest('com.user.cinemaapk');
  console.log(result.formattedOutput);
}

run().catch((err) => {
  console.error('Fatal error running hardware test:', err);
  process.exit(1);
});
