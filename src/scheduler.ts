import cron from 'node-cron'
import { Telegram } from 'telegraf'
import { getUpcomingConferences } from './db'
import { T, getLang, formatDate, formatTime } from './messages'

// Build the UTC window for "tomorrow" (configurable offset)
function getTomorrowWindow(hoursBefore: number): { from: Date; to: Date } {
  const now = new Date()
  const from = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000)
  // Window: from <hoursBefore> hours from now to <hoursBefore+24> hours from now
  // In practice with a daily cron this means "conferences happening tomorrow"
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000)
  return { from, to }
}

async function sendReminders(telegram: Telegram, hoursBefore: number): Promise<void> {
  const { from, to } = getTomorrowWindow(hoursBefore)
  console.log(`[scheduler] Checking conferences between ${from.toISOString()} and ${to.toISOString()}`)

  const conferences = await getUpcomingConferences(from, to)
  console.log(`[scheduler] Found ${conferences.length} upcoming conferences`)

  const sent = new Set<string>() // conferenceId:chatId — dedupe within a single run

  for (const conf of conferences) {
    const scheduledAt = new Date(conf.scheduledAt)

    // Notify teacher
    if (conf.teacherTgId) {
      const key = `${conf.id}:${conf.teacherTgId}`
      if (!sent.has(key)) {
        sent.add(key)
        const lang = getLang(conf.teacherLang)
        const studentNames = (conf.students ?? [])
          .filter(s => s.name)
          .map(s => s.name)

        const text = T.teacherReminder[lang]({
          lessonTitle: conf.title,
          studentNames,
          date: formatDate(scheduledAt, lang),
          time: formatTime(scheduledAt, lang),
        })

        await telegram.sendMessage(conf.teacherTgId, text, { parse_mode: 'Markdown' }).catch(err => {
          console.error(`[scheduler] Failed to notify teacher ${conf.teacherId}: ${err.message}`)
        })
      }
    }

    // Notify students
    for (const student of conf.students ?? []) {
      if (!student.telegramChatId) continue
      const key = `${conf.id}:${student.telegramChatId}`
      if (sent.has(key)) continue
      sent.add(key)

      const lang = getLang(student.langCode)
      const text = T.studentReminder[lang]({
        lessonTitle: conf.title,
        teacherName: conf.teacherName,
        date: formatDate(scheduledAt, lang),
        time: formatTime(scheduledAt, lang),
      })

      await telegram.sendMessage(student.telegramChatId, text, { parse_mode: 'Markdown' }).catch(err => {
        console.error(`[scheduler] Failed to notify student: ${err.message}`)
      })
    }
  }

  console.log(`[scheduler] Done. Sent ${sent.size} notification(s).`)
}

export function startScheduler(telegram: Telegram): void {
  const hour = parseInt(process.env.NOTIFY_HOUR ?? '9', 10)
  const hoursBefore = parseInt(process.env.NOTIFY_HOURS_BEFORE ?? '24', 10)

  // Run daily at configured hour, UTC
  const expression = `0 ${hour} * * *`
  console.log(`[scheduler] Cron: "${expression}" UTC — notifications ${hoursBefore}h before lesson`)

  cron.schedule(expression, () => {
    sendReminders(telegram, hoursBefore).catch(err => {
      console.error('[scheduler] Unhandled error:', err)
    })
  }, { timezone: 'UTC' })
}
