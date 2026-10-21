import { Sentinel } from './src/Sentinel';

const sentinel = new Sentinel();
const result = sentinel.verifyInvariants();

console.log(JSON.stringify(result, null, 2));

if (!result.passed) {
  process.exit(1);
}
