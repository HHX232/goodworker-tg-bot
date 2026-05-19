import 'dotenv/config'
import { createBot } from './bot'
import { startScheduler } from './scheduler'
import { pool } from './db'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set')
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

async function main() {
  // Verify DB connection
  await pool.query('SELECT 1')
  console.log('[db] Connected to database')

  const bot = createBot(token!)
  startScheduler(bot.telegram)

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))

  await bot.launch()
  console.log('[bot] Started (long polling)')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
