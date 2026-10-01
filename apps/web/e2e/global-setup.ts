import { resetE2E } from './reset';

/** Fresh database and empty mailbox before the run (each test resets again). */
export default async function globalSetup() {
  await resetE2E();
}
