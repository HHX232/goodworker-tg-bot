import { Pool } from 'pg'

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
  totalOwed: number
  currency: string | null
}

// Students whose unpaid confirmed-booking count has reached (or grown past) the
// teacher's configured "remind every N lessons" cadence, and haven't already been
// notified for this exact count (avoids re-sending the same reminder every day).
export async function getStudentsNeedingPaymentReminder(): Promise<PaymentReminderRow[]> {
  const res = await pool.query<PaymentReminderRow>(`
    WITH unpaid AS (
      SELECT sv."teacherId" AS "teacherId", sb."studentId" AS "studentId",
             COUNT(*)::int AS "unpaidCount", SUM(sb."finalPrice") AS "totalOwed",
             MAX(sv.currency) AS currency
      FROM "ServiceBooking" sb
      JOIN "Service" sv ON sv.id = sb."serviceId"
      WHERE sb.status = 'CONFIRMED' AND sb."paidAt" IS NULL
      GROUP BY sv."teacherId", sb."studentId"
    )
    SELECT
      prs."teacherId", prs."studentId", prs."everyNLessons",
      t.name AS "teacherName", t."langCode" AS "teacherLang", t."telegramChatId"::text AS "teacherTgId",
      s.name AS "studentName", s."langCode" AS "studentLang", s."telegramChatId"::text AS "studentTgId",
      COALESCE(u."unpaidCount", 0) AS "unpaidCount",
      COALESCE(u."totalOwed", 0) AS "totalOwed",
      u.currency
    FROM "PaymentReminderSetting" prs
    JOIN "Teacher" t ON t.id = prs."teacherId"
    JOIN "Student" s ON s.id = prs."studentId"
    LEFT JOIN unpaid u ON u."teacherId" = prs."teacherId" AND u."studentId" = prs."studentId"
    WHERE COALESCE(u."unpaidCount", 0) >= prs."everyNLessons"
      AND COALESCE(u."unpaidCount", 0) != prs."lastRemindedUnpaidCount"
  `)
  return res.rows
}

export async function markPaymentReminderSent(teacherId: string, studentId: string, unpaidCount: number): Promise<void> {
  await pool.query(
    `UPDATE "PaymentReminderSetting" SET "lastRemindedUnpaidCount" = $1, "updatedAt" = NOW() WHERE "teacherId" = $2 AND "studentId" = $3`,
    [unpaidCount, teacherId, studentId]
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
