import { Pool } from 'pg'
import { randomUUID } from 'crypto'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

export interface ConferenceRow {
  id: string
  title: string
  scheduledAt: Date
  teacherId: string
  teacherName: string
  teacherLang: string
  teacherTgId: string | null
  students: Array<{
    name: string
    langCode: string
    telegramChatId: string | null
  }> | null
}

// Find user by link token — checks both Student and Teacher tables
export async function findUserByToken(token: string): Promise<{
  id: string
  name: string
  langCode: string
  role: 'STUDENT' | 'TEACHER'
  telegramChatId: string | null
} | null> {
  const studentRes = await pool.query<{
    id: string; name: string; langCode: string; telegramChatId: string | null
  }>(
    `SELECT id, name, "langCode", "telegramChatId"::text FROM "Student" WHERE "telegramLinkToken" = $1 LIMIT 1`,
    [token]
  )
  if (studentRes.rows.length > 0) {
    return { ...studentRes.rows[0], role: 'STUDENT' }
  }

  const teacherRes = await pool.query<{
    id: string; name: string; langCode: string; telegramChatId: string | null
  }>(
    `SELECT id, name, "langCode", "telegramChatId"::text FROM "Teacher" WHERE "telegramLinkToken" = $1 LIMIT 1`,
    [token]
  )
  if (teacherRes.rows.length > 0) {
    return { ...teacherRes.rows[0], role: 'TEACHER' }
  }

  return null
}

// Save chatId and clear the token
export async function linkUser(id: string, role: 'STUDENT' | 'TEACHER', chatId: bigint): Promise<void> {
  const table = role === 'STUDENT' ? 'Student' : 'Teacher'
  await pool.query(
    `UPDATE "${table}" SET "telegramChatId" = $1, "telegramLinkToken" = NULL WHERE id = $2`,
    [chatId, id]
  )
}

// Find user by chatId (for /unlink)
export async function findUserByChatId(chatId: bigint): Promise<{
  id: string
  role: 'STUDENT' | 'TEACHER'
} | null> {
  const s = await pool.query(
    `SELECT id FROM "Student" WHERE "telegramChatId" = $1 LIMIT 1`,
    [chatId]
  )
  if (s.rows.length > 0) return { id: s.rows[0].id, role: 'STUDENT' }

  const t = await pool.query(
    `SELECT id FROM "Teacher" WHERE "telegramChatId" = $1 LIMIT 1`,
    [chatId]
  )
  if (t.rows.length > 0) return { id: t.rows[0].id, role: 'TEACHER' }

  return null
}

// Remove chatId (unlink)
export async function unlinkUser(id: string, role: 'STUDENT' | 'TEACHER'): Promise<void> {
  const table = role === 'STUDENT' ? 'Student' : 'Teacher'
  await pool.query(
    `UPDATE "${table}" SET "telegramChatId" = NULL WHERE id = $1`,
    [id]
  )
}

// Get all SCHEDULED conferences within a time window with participant info
export async function getUpcomingConferences(from: Date, to: Date): Promise<ConferenceRow[]> {
  const res = await pool.query<ConferenceRow>(`
    SELECT
      c.id,
      c.title,
      c."scheduledAt",
      c."teacherId",
      t.name AS "teacherName",
      t."langCode" AS "teacherLang",
      t."telegramChatId"::text AS "teacherTgId",
      (
        SELECT json_agg(json_build_object(
          'name', s.name,
          'langCode', s."langCode",
          'telegramChatId', s."telegramChatId"::text
        ))
        FROM "ConferenceParticipant" cp
        JOIN "Student" s ON s.id = cp."studentId"
        WHERE cp."conferenceId" = c.id
          AND cp."studentId" IS NOT NULL
      ) AS students
    FROM "Conference" c
    JOIN "Teacher" t ON c."teacherId" = t.id
    WHERE c.status = 'SCHEDULED'
      AND c."scheduledAt" >= $1
      AND c."scheduledAt" < $2
    ORDER BY c."scheduledAt"
  `, [from, to])

  return res.rows
}

export interface HomeworkReminderRow {
  assignmentId: string
  homeworkTitle: string
  dueAt: Date
  studentName: string
  studentTgId: string
  studentLang: string
}

export interface PaymentReminderRow {
  teacherId: string
  studentId: string
  everyNLessons: number
  teacherName: string
  teacherLang: string
  teacherTgId: string | null
  studentName: string
  studentLang: string
  studentTgId: string | null
  unpaidCount: number
  // Grouped by currency rather than summed — a student can in principle owe
  // for lessons priced in different currencies.
  totals: { currency: string; amount: number }[]
}

// Students whose unpaid lesson count has reached (or grown past) the teacher's
// configured "remind every N lessons" cadence, and haven't already been
// notified for this exact count (avoids re-sending the same reminder every day).
//
// "Unpaid lesson" is counted from every place a billable lesson can come from —
// mirrors isBillableEvent in src/shared/helpers/calendar/eventBilling.ts:
//   1. confirmed ServiceBooking rows (the public "book a service" flow)
//   2. calendar events with a service attached — manually scheduled, edited, or
//      created via the calendar's "repeat" option (stored as JSON on
//      Teacher.calendar.events); "booking-*" ids are skipped there since they're
//      already counted via their ServiceBooking row (avoids double-counting).
export async function getStudentsNeedingPaymentReminder(): Promise<PaymentReminderRow[]> {
  const res = await pool.query<Omit<PaymentReminderRow, 'totals'> & { totals: PaymentReminderRow['totals'] | null }>(`
    WITH calendar_events AS (
      SELECT t.id AS "teacherId", elem
      FROM "Teacher" t,
           LATERAL jsonb_array_elements(COALESCE(t.calendar -> 'events', '[]'::jsonb)) AS elem
    ),
    all_unpaid AS (
      SELECT sv."teacherId" AS "teacherId", sb."studentId" AS "studentId",
             sv.currency AS currency, sb."finalPrice" AS amount
      FROM "ServiceBooking" sb
      JOIN "Service" sv ON sv.id = sb."serviceId"
      WHERE sb.status = 'CONFIRMED' AND sb."paidAt" IS NULL

      UNION ALL

      SELECT "teacherId", (elem ->> 'studentId') AS "studentId",
             (elem ->> 'serviceCurrency') AS currency,
             ROUND(
               (elem ->> 'servicePrice')::numeric *
               COALESCE((elem ->> 'durationMinutes')::numeric, 60) /
               (elem ->> 'serviceDurationMinutes')::numeric
             ) AS amount
      FROM calendar_events
      WHERE elem ->> 'serviceId' IS NOT NULL
        AND elem ->> 'servicePrice' IS NOT NULL
        AND elem ->> 'serviceDurationMinutes' IS NOT NULL
        AND elem ->> 'studentId' IS NOT NULL
        AND COALESCE(elem ->> 'status', 'scheduled') != 'cancelled'
        AND (elem ->> 'id') NOT LIKE 'booking-%'
        AND COALESCE((elem ->> 'paid')::boolean, false) = false
    ),
    counts AS (
      SELECT "teacherId", "studentId", COUNT(*)::int AS "unpaidCount"
      FROM all_unpaid
      GROUP BY "teacherId", "studentId"
    ),
    totals AS (
      SELECT "teacherId", "studentId",
             json_agg(json_build_object('currency', currency, 'amount', amount_sum)) AS totals
      FROM (
        SELECT "teacherId", "studentId", currency, SUM(amount) AS amount_sum
        FROM all_unpaid
        GROUP BY "teacherId", "studentId", currency
      ) per_currency
      GROUP BY "teacherId", "studentId"
    )
    SELECT
      prs."teacherId", prs."studentId", prs."everyNLessons",
      t.name AS "teacherName", t."langCode" AS "teacherLang", t."telegramChatId"::text AS "teacherTgId",
      s.name AS "studentName", s."langCode" AS "studentLang", s."telegramChatId"::text AS "studentTgId",
      COALESCE(c."unpaidCount", 0) AS "unpaidCount",
      tot.totals AS totals
    FROM "PaymentReminderSetting" prs
    JOIN "Teacher" t ON t.id = prs."teacherId"
    JOIN "Student" s ON s.id = prs."studentId"
    LEFT JOIN counts c ON c."teacherId" = prs."teacherId" AND c."studentId" = prs."studentId"
    LEFT JOIN totals tot ON tot."teacherId" = prs."teacherId" AND tot."studentId" = prs."studentId"
    WHERE COALESCE(c."unpaidCount", 0) >= prs."everyNLessons"
      AND COALESCE(c."unpaidCount", 0) != prs."lastRemindedUnpaidCount"
  `)
  return res.rows.map(r => ({ ...r, totals: r.totals ?? [] }))
}

export async function markPaymentReminderSent(teacherId: string, studentId: string, unpaidCount: number): Promise<void> {
  await pool.query(
    `UPDATE "PaymentReminderSetting" SET "lastRemindedUnpaidCount" = $1, "updatedAt" = NOW() WHERE "teacherId" = $2 AND "studentId" = $3`,
    [unpaidCount, teacherId, studentId]
  )
}

// In-app notification for the student — separate from (and in addition to) the
// Telegram message, and always created regardless of whether Telegram is even
// linked. "PAYMENT_REMINDER" is intentionally not part of the main app's
// NOTIFICATION_TYPES catalog, so it never shows up as a toggle in notification
// settings — the student can't turn it off.
export async function createPaymentReminderNotification(
  studentId: string, title: string, body: string, payload: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO "Notification" (id, type, title, body, payload, "isRead", "studentId", "createdAt")
     VALUES ($1, 'PAYMENT_REMINDER', $2, $3, $4::jsonb, false, $5, NOW())`,
    [randomUUID(), title, body, JSON.stringify(payload), studentId]
  )
}

// Chat event card companion to `createPaymentReminderNotification` above (R15,
// ticket 05) — same checkpoint moment, third side effect. Get-or-create the
// teacher↔student `Conversation` (raw SQL, same `pg` pool as everything else
// in this file — the main app's Prisma `access.ts` isn't reachable from
// tg-bot) via `ON CONFLICT` on the `(teacherId, studentId)` unique index
// (mirrors `POST /api/chat/conversations`'s `upsert`), bumping
// `lastMessageAt` either way so the new card surfaces at the top of the
// list, then insert a `ChatMessage` with `eventType: 'PAYMENT_REMINDER'` and
// the same `payload` already used for the Telegram/notification text.
export async function createPaymentReminderChatCard(
  teacherId: string, studentId: string, payload: Record<string, unknown>
): Promise<void> {
  const convRes = await pool.query<{ id: string }>(
    `INSERT INTO "Conversation" (id, "teacherId", "studentId", "createdAt", "lastMessageAt")
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT ("teacherId", "studentId") DO UPDATE SET "lastMessageAt" = NOW()
     RETURNING id`,
    [randomUUID(), teacherId, studentId]
  )
  const conversationId = convRes.rows[0].id

  await pool.query(
    `INSERT INTO "ChatMessage" (id, "conversationId", "senderRole", "eventType", "eventPayload", "isRead", "createdAt")
     VALUES ($1, $2, 'TEACHER', 'PAYMENT_REMINDER', $3::jsonb, false, NOW())`,
    [randomUUID(), conversationId, JSON.stringify(payload)]
  )
}

export async function getUpcomingHomeworkAssignments(from: Date, to: Date): Promise<HomeworkReminderRow[]> {
  const res = await pool.query<HomeworkReminderRow>(`
    SELECT
      ha.id AS "assignmentId",
      h.title AS "homeworkTitle",
      h."dueAt",
      s.name AS "studentName",
      s."telegramChatId"::text AS "studentTgId",
      s."langCode" AS "studentLang"
    FROM "HomeworkAssignment" ha
    JOIN "Homework" h ON ha."homeworkId" = h.id
    JOIN "Student" s ON ha."studentId" = s.id
    WHERE h."dueAt" >= $1
      AND h."dueAt" < $2
      AND ha.status NOT IN ('SUBMITTED', 'REVIEWED')
      AND s."telegramChatId" IS NOT NULL
    ORDER BY h."dueAt"
  `, [from, to])
  return res.rows
}
