import cron from 'node-cron'
import { Telegram } from 'telegraf'
import { getUpcomingConferences, getUpcomingHomeworkAssignments, getStudentsNeedingPaymentReminder, markPaymentReminderSent, createPaymentReminderNotification, createPaymentReminderChatCard } from './db'
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

async function sendHomeworkReminders(telegram: Telegram, hoursBefore: number): Promise<void> {
  const now = new Date()
  const from = new Date(now.getTime() + (hoursBefore - 1) * 60 * 60 * 1000)
  const to = new Date(now.getTime() + (hoursBefore + 1) * 60 * 60 * 1000)
  console.log(`[scheduler] Checking homework due between ${from.toISOString()} and ${to.toISOString()}`)

  const assignments = await getUpcomingHomeworkAssignments(from, to)
  console.log(`[scheduler] Found ${assignments.length} homework assignment(s) due soon`)

  const sent = new Set<string>()
  for (const a of assignments) {
    if (sent.has(a.assignmentId)) continue
    sent.add(a.assignmentId)

    const lang = getLang(a.studentLang)
    const due = new Date(a.dueAt)
    const text = lang === 'ru'
      ? `📚 *Напоминание о домашнем задании*\n\n«${a.homeworkTitle}»\n\nСдать до: ${formatDate(due, lang)} в ${formatTime(due, lang)}\n\nНе забудьте выполнить домашнее задание!`
      : `📚 *Homework reminder*\n\n«${a.homeworkTitle}»\n\nDue: ${formatDate(due, lang)} at ${formatTime(due, lang)}\n\nDon't forget to complete your homework!`

    await telegram.sendMessage(a.studentTgId, text, { parse_mode: 'Markdown' }).catch((err: Error) => {
      console.error(`[scheduler] Failed to send homework reminder to student: ${err.message}`)
    })
  }

  console.log(`[scheduler] Done. Sent ${sent.size} homework reminder(s).`)
}

// Two-sided: notifies both the student (please pay) and the teacher (reminder sent)
// once a student's unpaid confirmed-booking count reaches the teacher's configured
// "remind every N lessons" cadence (set via the calendar's payment reminder modal).
async function sendPaymentReminders(telegram: Telegram): Promise<void> {
  const rows = await getStudentsNeedingPaymentReminder()
  console.log(`[scheduler] Found ${rows.length} student(s) due for a payment reminder`)

  for (const row of rows) {
    const totalsText = row.totals.length > 0
      ? row.totals.map(t => `${t.amount} ${t.currency}`).join(' + ')
      : '0'

    // In-app notification — always created, independent of Telegram being
    // linked at all, so this reminder always reaches the student somehow.
    await createPaymentReminderNotification(
      row.studentId,
      'Напоминание об оплате',
      `У вас накопилось ${row.unpaidCount} неоплаченных занятий с репетитором ${row.teacherName}. Сумма к оплате: ${totalsText}.`,
      { teacherName: row.teacherName, unpaidCount: row.unpaidCount, totals: row.totals }
    ).catch(err => {
      console.error(`[scheduler] Failed to create in-app payment reminder notification: ${err.message}`)
    })

    // Chat event card (R15) — same payload as the notification/Telegram text above.
    await createPaymentReminderChatCard(
      row.teacherId,
      row.studentId,
      { teacherName: row.teacherName, unpaidCount: row.unpaidCount, totals: row.totals }
    ).catch(err => {
      console.error(`[scheduler] Failed to create payment reminder chat card: ${err.message}`)
    })

    if (row.studentTgId) {
      const lang = getLang(row.studentLang)
      const text = T.paymentReminderStudent[lang]({
        teacherName: row.teacherName,
        unpaidCount: row.unpaidCount,
        totalsText,
      })
      await telegram.sendMessage(row.studentTgId, text, { parse_mode: 'Markdown' }).catch(err => {
        console.error(`[scheduler] Failed to send payment reminder to student: ${err.message}`)
      })
    }

    if (row.teacherTgId) {
      const lang = getLang(row.teacherLang)
      const text = T.paymentReminderTeacher[lang]({
        studentName: row.studentName,
        unpaidCount: row.unpaidCount,
        totalsText,
      })
      await telegram.sendMessage(row.teacherTgId, text, { parse_mode: 'Markdown' }).catch(err => {
        console.error(`[scheduler] Failed to notify teacher of payment reminder: ${err.message}`)
      })
    }

    await markPaymentReminderSent(row.teacherId, row.studentId, row.unpaidCount)
  }

  console.log(`[scheduler] Done. Processed ${rows.length} payment reminder(s).`)
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
    sendHomeworkReminders(telegram, hoursBefore).catch(err => {
      console.error('[scheduler] Homework reminders error:', err)
    })
    sendPaymentReminders(telegram).catch(err => {
      console.error('[scheduler] Payment reminders error:', err)
    })
  }, { timezone: 'UTC' })
}
