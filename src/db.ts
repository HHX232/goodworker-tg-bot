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
