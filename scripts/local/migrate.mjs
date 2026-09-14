// npm run local:migrate — start the local database, apply any new migrations, stop it again.

import { startDatabase, migrate } from './db.mjs'

const { server, pg } = await startDatabase()
try {
  await migrate(pg)
} catch (e) {
  console.error(`\nMIGRATION FAILED — ${e.message}`)
  process.exitCode = 1
} finally {
  await server.stop()
}
