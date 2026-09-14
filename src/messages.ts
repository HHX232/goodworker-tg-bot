export type Lang = 'ru' | 'en' | 'hi' | 'zh'

const SUPPORTED: Lang[] = ['ru', 'en', 'hi', 'zh']

export function getLang(code: string): Lang {
  return SUPPORTED.includes(code as Lang) ? (code as Lang) : 'en'
}

export function formatDate(date: Date, lang: Lang): string {
  const locale = { ru: 'ru-RU', en: 'en-US', hi: 'hi-IN', zh: 'zh-CN' }[lang]
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(date)
}

export function formatTime(date: Date, lang: Lang): string {
  const locale = { ru: 'ru-RU', en: 'en-US', hi: 'hi-IN', zh: 'zh-CN' }[lang]
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
}

// ─── Templates ────────────────────────────────────────────────────────────────

interface StudentReminderVars {
  lessonTitle: string
  teacherName: string
  date: string
  time: string
}

interface TeacherReminderVars {
  lessonTitle: string
  studentNames: string[]
  date: string
  time: string
}

interface PaymentReminderStudentVars {
  teacherName: string
  unpaidCount: number
  totalOwed: number
  currency: string
}

interface PaymentReminderTeacherVars {
  studentName: string
  unpaidCount: number
  totalOwed: number
  currency: string
}

export const T = {
  welcome: {
    ru: (name: string) =>
      `✅ Аккаунт привязан! Привет, *${name}*!\n\nТеперь ты будешь получать напоминания об уроках за день до их начала.\n\n/unlink — чтобы отвязать аккаунт`,
    en: (name: string) =>
      `✅ Account linked! Hi, *${name}*!\n\nYou'll now receive lesson reminders one day before each class.\n\n/unlink — to unlink your account`,
    hi: (name: string) =>
      `✅ खाता जुड़ गया! नमस्ते, *${name}*!\n\nआपको हर पाठ से एक दिन पहले याद दिलाई जाएगी।\n\n/unlink — खाता हटाने के लिए`,
    zh: (name: string) =>
      `✅ 账号已绑定！你好，*${name}*！\n\n您将在每堂课前一天收到提醒。\n\n/unlink — 解绑账号`,
  },

  alreadyLinked: {
    ru: '⚠️ Этот токен уже использован или привязан к другому аккаунту Telegram.',
    en: '⚠️ This token has already been used or linked to another Telegram account.',
    hi: '⚠️ यह टोकन पहले ही उपयोग किया जा चुका है या दूसरे Telegram से जुड़ा है।',
    zh: '⚠️ 此令牌已被使用或绑定到其他 Telegram 账号。',
  },

  invalidToken: {
    ru: '❌ Ссылка недействительна или устарела.\n\nСгенерируй новую в настройках профиля на сайте.',
    en: '❌ The link is invalid or expired.\n\nGenerate a new one in your profile settings.',
    hi: '❌ लिंक अमान्य या समाप्त हो गई है।\n\nप्रोफ़ाइल सेटिंग्स में नई बनाएं।',
    zh: '❌ 链接无效或已过期。\n\n请在个人资料设置中生成新链接。',
  },

  noToken: {
    ru: 'Привет! Чтобы получать уведомления об уроках, перейди в настройки профиля на сайте и нажми «Подключить Telegram».',
    en: "Hi! To receive lesson notifications, go to your profile settings and click 'Connect Telegram'.",
    hi: 'नमस्ते! पाठ की सूचनाएं पाने के लिए, अपनी प्रोफ़ाइल सेटिंग्स में जाएं और "Telegram जोड़ें" पर क्लिक करें।',
    zh: '你好！要接收课程通知，请前往个人资料设置，点击"连接 Telegram"。',
  },

  unlinked: {
    ru: '✅ Telegram отвязан. Уведомления больше не будут приходить.',
    en: '✅ Telegram unlinked. You will no longer receive notifications.',
    hi: '✅ Telegram हटा दिया गया। अब सूचनाएं नहीं आएंगी।',
    zh: '✅ Telegram 已解绑。您将不再收到通知。',
  },

  notLinked: {
    ru: 'Твой аккаунт не привязан. Воспользуйся ссылкой из настроек профиля.',
    en: 'Your account is not linked. Use the link from your profile settings.',
    hi: 'आपका खाता जुड़ा नहीं है। प्रोफ़ाइल सेटिंग्स की लिंक का उपयोग करें।',
    zh: '您的账号未绑定。请使用个人资料设置中的链接。',
  },

  studentReminder: {
    ru: ({ lessonTitle, teacherName, date, time }: StudentReminderVars) =>
      `📚 *Напоминание об уроке!*\n\n` +
      `📝 ${lessonTitle}\n` +
      `👤 Репетитор: ${teacherName}\n` +
      `📅 ${date} в ${time}\n\n` +
      `_Удачного урока!_`,
    en: ({ lessonTitle, teacherName, date, time }: StudentReminderVars) =>
      `📚 *Lesson Reminder!*\n\n` +
      `📝 ${lessonTitle}\n` +
      `👤 Teacher: ${teacherName}\n` +
      `📅 ${date} at ${time}\n\n` +
      `_Good luck!_`,
    hi: ({ lessonTitle, teacherName, date, time }: StudentReminderVars) =>
      `📚 *पाठ याद दिलाने वाला!*\n\n` +
      `📝 ${lessonTitle}\n` +
      `👤 शिक्षक: ${teacherName}\n` +
      `📅 ${date} को ${time} पर\n\n` +
      `_शुभकामनाएं!_`,
    zh: ({ lessonTitle, teacherName, date, time }: StudentReminderVars) =>
      `📚 *课程提醒！*\n\n` +
      `📝 ${lessonTitle}\n` +
      `👤 教师：${teacherName}\n` +
      `📅 ${date} ${time}\n\n` +
      `_祝学习顺利！_`,
  },

  teacherReminder: {
    ru: ({ lessonTitle, studentNames, date, time }: TeacherReminderVars) =>
      `📚 *Напоминание об уроке!*\n\n` +
      `📝 ${lessonTitle}\n` +
      `👥 Ученики: ${studentNames.length ? studentNames.join(', ') : 'не указаны'}\n` +
      `📅 ${date} в ${time}\n\n` +
      `_Удачного урока!_`,
    en: ({ lessonTitle, studentNames, date, time }: TeacherReminderVars) =>
      `📚 *Lesson Reminder!*\n\n` +
      `📝 ${lessonTitle}\n` +
      `👥 Students: ${studentNames.length ? studentNames.join(', ') : 'none listed'}\n` +
      `📅 ${date} at ${time}\n\n` +
      `_Good luck!_`,
    hi: ({ lessonTitle, studentNames, date, time }: TeacherReminderVars) =>
      `📚 *पाठ याद दिलाने वाला!*\n\n` +
      `📝 ${lessonTitle}\n` +
      `👥 छात्र: ${studentNames.length ? studentNames.join(', ') : 'कोई नहीं'}\n` +
      `📅 ${date} को ${time} पर\n\n` +
      `_शुभकामनाएं!_`,
    zh: ({ lessonTitle, studentNames, date, time }: TeacherReminderVars) =>
      `📚 *课程提醒！*\n\n` +
      `📝 ${lessonTitle}\n` +
      `👥 学生：${studentNames.length ? studentNames.join('、') : '未指定'}\n` +
      `📅 ${date} ${time}\n\n` +
      `_祝课程顺利！_`,
  },

  paymentReminderStudent: {
    ru: ({ teacherName, unpaidCount, totalOwed, currency }: PaymentReminderStudentVars) =>
      `💰 *Напоминание об оплате*\n\n` +
      `У вас накопилось ${unpaidCount} неоплаченных занятий с репетитором ${teacherName}.\n` +
      `Сумма к оплате: *${totalOwed} ${currency}*\n\n` +
      `Пожалуйста, свяжитесь с репетитором для оплаты.`,
    en: ({ teacherName, unpaidCount, totalOwed, currency }: PaymentReminderStudentVars) =>
      `💰 *Payment reminder*\n\n` +
      `You have ${unpaidCount} unpaid lesson(s) with tutor ${teacherName}.\n` +
      `Amount due: *${totalOwed} ${currency}*\n\n` +
      `Please reach out to your tutor to settle the payment.`,
    hi: ({ teacherName, unpaidCount, totalOwed, currency }: PaymentReminderStudentVars) =>
      `💰 *भुगतान अनुस्मारक*\n\n` +
      `शिक्षक ${teacherName} के साथ आपके ${unpaidCount} पाठों का भुगतान बाकी है।\n` +
      `देय राशि: *${totalOwed} ${currency}*\n\n` +
      `कृपया भुगतान के लिए अपने शिक्षक से संपर्क करें।`,
    zh: ({ teacherName, unpaidCount, totalOwed, currency }: PaymentReminderStudentVars) =>
      `💰 *付款提醒*\n\n` +
      `您与教师 ${teacherName} 有 ${unpaidCount} 节课尚未付款。\n` +
      `应付金额：*${totalOwed} ${currency}*\n\n` +
      `请联系您的教师完成付款。`,
  },

  paymentReminderTeacher: {
    ru: ({ studentName, unpaidCount, totalOwed, currency }: PaymentReminderTeacherVars) =>
      `💰 *Напоминание об оплате*\n\n` +
      `Ученик ${studentName}: ${unpaidCount} неоплаченных занятий на сумму *${totalOwed} ${currency}*.\n\n` +
      `Ученику отправлено напоминание.`,
    en: ({ studentName, unpaidCount, totalOwed, currency }: PaymentReminderTeacherVars) =>
      `💰 *Payment reminder*\n\n` +
      `Student ${studentName}: ${unpaidCount} unpaid lesson(s) totaling *${totalOwed} ${currency}*.\n\n` +
      `A reminder was sent to the student.`,
    hi: ({ studentName, unpaidCount, totalOwed, currency }: PaymentReminderTeacherVars) =>
      `💰 *भुगतान अनुस्मारक*\n\n` +
      `छात्र ${studentName}: ${unpaidCount} पाठ बकाया, कुल *${totalOwed} ${currency}*।\n\n` +
      `छात्र को अनुस्मारक भेज दिया गया है।`,
    zh: ({ studentName, unpaidCount, totalOwed, currency }: PaymentReminderTeacherVars) =>
      `💰 *付款提醒*\n\n` +
      `学生 ${studentName}：${unpaidCount} 节课未付款，共计 *${totalOwed} ${currency}*。\n\n` +
      `已向学生发送提醒。`,
  },
}
